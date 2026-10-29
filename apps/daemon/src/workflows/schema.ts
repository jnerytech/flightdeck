import { PermissionMode } from "@flightdeck/protocol";
import { type core, z } from "zod";

export interface AgentAction {
  prompt: string;
  /** Sends the prompt to the session of that (earlier, `agent`) step instead of a new one. */
  continue?: string;
  permissionMode?: PermissionMode;
}

/** What a step inside a `loop` or a `parallel` can do. */
export type InnerAction = { agent: AgentAction } | { check: string };

export type Action =
  | InnerAction
  | { gate: { message: string; show?: string } }
  | { loop: { max: number; until: { check: string }; do: InnerAction } }
  | { parallel: InnerAction[] }
  | { pr: Record<string, never> };

export type Step = { id: string } & Action;

export interface Budget {
  maxTurns?: number;
  maxMinutes?: number;
  maxCostUsd?: number;
}

export interface Workflow {
  name?: string;
  inputs: string[];
  budget: Budget;
  steps: Step[];
}

export interface ParsedWorkflow {
  workflow: Workflow | null;
  errors: string[];
}

/** `{{ expression }}` inside prompts and gate texts. */
export const REFERENCE = /\{\{\s*(.*?)\s*\}\}/g;

const ACTIONS = ["agent", "check", "gate", "loop", "parallel", "pr"] as const;
const INNER_ACTIONS = ["agent", "check"] as const;

const text = z.string().min(1, "não pode ser vazio");
const positive = z.number().positive("precisa ser maior que zero");

const AgentSchema = z.strictObject({
  prompt: text,
  continue: text.optional(),
  permissionMode: PermissionMode.optional(),
});
const InnerSchema = z.strictObject({ agent: AgentSchema.optional(), check: text.optional() });
const StepSchema = z.strictObject({
  id: text,
  agent: AgentSchema.optional(),
  check: text.optional(),
  gate: z.strictObject({ message: text, show: z.string().optional() }).optional(),
  loop: z
    .strictObject({
      max: z
        .number()
        .int("precisa ser um inteiro maior que zero")
        .min(1, "precisa ser um inteiro maior que zero"),
      until: z.strictObject({ check: text }),
      do: InnerSchema,
    })
    .optional(),
  parallel: z.array(InnerSchema).min(1, "precisa de ao menos um item").optional(),
  pr: z.strictObject({}).optional(),
});
const WorkflowSchema = z.strictObject({
  name: text.optional(),
  inputs: z.array(z.string().regex(/^[\w-]+$/, "nome de input inválido")).default([]),
  budget: z
    .strictObject({
      maxTurns: positive.int("precisa ser um inteiro").optional(),
      maxMinutes: positive.optional(),
      maxCostUsd: positive.optional(),
    })
    .default({}),
  steps: z.array(StepSchema),
});

type RawStep = z.infer<typeof StepSchema>;
type RawInner = z.infer<typeof InnerSchema>;

/** Messages for what the schemas above leave to zod's defaults. */
function message(issue: core.$ZodRawIssue): string {
  if (issue.code === "unrecognized_keys") return `campo desconhecido: ${issue.keys.join(", ")}`;
  if (issue.input === undefined) return "obrigatório";
  if (issue.code === "invalid_type") {
    return issue.expected === "object" ? "precisa ser um objeto" : "tipo inválido";
  }
  return "valor inválido";
}

const where = (path: readonly PropertyKey[]) =>
  path.length === 0 ? "(raiz)" : path.map(String).join(".");

/** Loads a workflow file and validates it; `workflow` is `null` whenever there is an error. */
export function parseWorkflow(source: string): ParsedWorkflow {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(source);
  } catch (error) {
    return { workflow: null, errors: [`YAML inválido: ${(error as Error).message}`] };
  }
  const parsed = WorkflowSchema.safeParse(raw, { error: message });
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${where(i.path)}: ${i.message}`);
    return { workflow: null, errors };
  }
  const workflow = parsed.data as Workflow;
  const errors = validate(workflow.inputs, parsed.data.steps);
  return errors.length > 0 ? { workflow: null, errors } : { workflow, errors };
}

const actionsOf = (step: RawStep | RawInner, keys: readonly string[]) =>
  keys.filter((key) => (step as Record<string, unknown>)[key] !== undefined);

/** What the schema cannot see: one action per step, ids, `continue` and `{{…}}` references. */
function validate(inputs: string[], steps: RawStep[]): string[] {
  const errors: string[] = [];
  /** Earlier steps: id → action. */
  const earlier = new Map<string, string | undefined>();
  steps.forEach((step, i) => {
    const fail = (problem: string) => errors.push(`steps.${i} (${step.id}): ${problem}`);
    const actions = actionsOf(step, ACTIONS);
    if (actions.length !== 1) {
      fail("a etapa precisa de exatamente uma ação (agent, check, gate, loop, parallel ou pr)");
    }
    if (earlier.has(step.id)) fail("id repetido");
    const inner: Array<[string, RawInner]> = [
      ...(step.loop ? ([["loop.do", step.loop.do]] as Array<[string, RawInner]>) : []),
      ...(step.parallel ?? []).map((item, j): [string, RawInner] => [`parallel.${j}`, item]),
    ];
    for (const [path, item] of inner) {
      if (actionsOf(item, INNER_ACTIONS).length !== 1) {
        fail(`${path}: precisa de exatamente uma ação (agent ou check)`);
      }
    }
    const agents = [step.agent, ...inner.map(([, item]) => item.agent)];
    for (const agent of agents) {
      if (agent?.continue && earlier.get(agent.continue) !== "agent") {
        fail(`continue para etapa inexistente: ${agent.continue}`);
      }
    }
    const templates: Array<[string, boolean]> = [
      ...[step.agent?.prompt, step.gate?.message, step.gate?.show].map((t): [string, boolean] => [
        t ?? "",
        false,
      ]),
      ...inner.map(([path, item]): [string, boolean] => [
        item.agent?.prompt ?? "",
        path === "loop.do",
      ]),
    ];
    for (const [template, inLoop] of templates) {
      for (const [raw, expression] of template.matchAll(REFERENCE)) {
        if (!known(expression ?? "", { inputs, earlier, inLoop })) {
          fail(`referência desconhecida: ${raw}`);
        }
      }
    }
    earlier.set(step.id, actions.length === 1 ? actions[0] : undefined);
  });
  return errors;
}

function known(
  expression: string,
  scope: { inputs: string[]; earlier: Map<string, string | undefined>; inLoop: boolean },
): boolean {
  const input = /^inputs\.([\w-]+)$/.exec(expression);
  if (input) return scope.inputs.includes(input[1] ?? "");
  const output = /^steps\.([\w-]+)\.(output|outputs)$/.exec(expression);
  if (output) {
    const id = output[1] ?? "";
    if (!scope.earlier.has(id)) return false;
    return (scope.earlier.get(id) === "parallel") === (output[2] === "outputs");
  }
  return scope.inLoop && /^loop\.lastCheck\.(output|exitCode)$/.test(expression);
}

/** Every `check` command of the workflow, once each, in the order they appear. */
export function checkCommands(workflow: Workflow): string[] {
  const commands = workflow.steps.flatMap((step) => {
    if ("check" in step) return [step.check];
    if ("loop" in step) {
      const inner = step.loop.do;
      return [step.loop.until.check, ...("check" in inner ? [inner.check] : [])];
    }
    if ("parallel" in step) return step.parallel.flatMap((i) => ("check" in i ? [i.check] : []));
    return [];
  });
  return [...new Set(commands)];
}
