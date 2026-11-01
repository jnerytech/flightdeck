import { PermissionMode, type RuleIssue } from "@flightdeck/protocol";
import { type core, z } from "zod";

export interface AgentAction {
  prompt: string;
  /** Opens the step's session in that persona (phase 20). */
  persona?: string;
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
  /** The English text of each problem. */
  errors: string[];
  /** The same problems as codes with params, for the app to translate. */
  issues: RuleIssue[];
}

/** The English text of each kind of issue, for logs and the CLI. */
const ENGLISH: Record<string, (params: Record<string, string>) => string> = {
  yaml_invalid: (p) => `invalid YAML: ${p.detail}`,
  unknown_field: (p) => `unknown field: ${p.field}`,
  required: () => "required",
  not_object: () => "must be an object",
  invalid_type: () => "invalid type",
  invalid_value: () => "invalid value",
  not_empty: () => "cannot be empty",
  positive: () => "must be greater than zero",
  positive_int: () => "must be a whole number greater than zero",
  parallel_empty: () => "needs at least one item",
  input_name_invalid: () => "invalid input name",
  persona_invalid: () => "invalid persona id",
  step_one_action: () =>
    "the step needs exactly one action (agent, check, gate, loop, parallel or pr)",
  step_id_duplicate: () => "repeated id",
  inner_one_action: (p) => `${p.where}: needs exactly one action (agent or check)`,
  continue_unknown: (p) => `continue points to a step that does not exist: ${p.step}`,
  persona_with_continue: () => "persona does not apply with continue: that step's session exists",
  reference_unknown: (p) => `unknown reference: ${p.ref}`,
};

const issue = (path: string, code: string, params?: Record<string, string>): RuleIssue => ({
  path,
  code,
  ...(params ? { params } : {}),
});

const describeIssue = (item: RuleIssue) => {
  const text = ENGLISH[item.code]?.((item.params ?? {}) as Record<string, string>) ?? item.code;
  return item.path ? `${item.path}: ${text}` : text;
};

/** `{{ expression }}` inside prompts and gate texts. */
export const REFERENCE = /\{\{\s*(.*?)\s*\}\}/g;

const ACTIONS = ["agent", "check", "gate", "loop", "parallel", "pr"] as const;
const INNER_ACTIONS = ["agent", "check"] as const;

const text = z.string().min(1, "not_empty");
const positive = z.number().positive("positive");

const AgentSchema = z.strictObject({
  prompt: text,
  persona: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "persona_invalid")
    .optional(),
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
      max: z.number().int("positive_int").min(1, "positive_int"),
      until: z.strictObject({ check: text }),
      do: InnerSchema,
    })
    .optional(),
  parallel: z.array(InnerSchema).min(1, "parallel_empty").optional(),
  pr: z.strictObject({}).optional(),
});
const WorkflowSchema = z.strictObject({
  name: text.optional(),
  inputs: z.array(z.string().regex(/^[\w-]+$/, "input_name_invalid")).default([]),
  budget: z
    .strictObject({
      maxTurns: positive.int("positive_int").optional(),
      maxMinutes: positive.optional(),
      maxCostUsd: positive.optional(),
    })
    .default({}),
  steps: z.array(StepSchema),
});

type RawStep = z.infer<typeof StepSchema>;
type RawInner = z.infer<typeof InnerSchema>;

/** The code of what the schemas above leave to zod's defaults (`unknown_field:<keys>` carries its param). */
function message(raw: core.$ZodRawIssue): string {
  if (raw.code === "unrecognized_keys") return `unknown_field:${raw.keys.join(", ")}`;
  if (raw.input === undefined) return "required";
  if (raw.code === "invalid_type") return raw.expected === "object" ? "not_object" : "invalid_type";
  return "invalid_value";
}

const where = (path: readonly PropertyKey[]) =>
  path.length === 0 ? "(root)" : path.map(String).join(".");

/** Loads a workflow file and validates it; `workflow` is `null` whenever there is an error. */
export function parseWorkflow(source: string): ParsedWorkflow {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(source);
  } catch (error) {
    const issues = [issue("", "yaml_invalid", { detail: (error as Error).message })];
    return { workflow: null, errors: issues.map(describeIssue), issues };
  }
  const parsed = WorkflowSchema.safeParse(raw, { error: message });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const [code = "invalid_value", detail] = i.message.split(/:(.*)/s);
      return issue(where(i.path), code, detail === undefined ? undefined : { field: detail });
    });
    return { workflow: null, errors: issues.map(describeIssue), issues };
  }
  const workflow = parsed.data as Workflow;
  const issues = validate(workflow.inputs, parsed.data.steps);
  const errors = issues.map(describeIssue);
  return issues.length > 0 ? { workflow: null, errors, issues } : { workflow, errors, issues };
}

const actionsOf = (step: RawStep | RawInner, keys: readonly string[]) =>
  keys.filter((key) => (step as Record<string, unknown>)[key] !== undefined);

/** What the schema cannot see: one action per step, ids, `continue` and `{{…}}` references. */
function validate(inputs: string[], steps: RawStep[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  /** Earlier steps: id → action. */
  const earlier = new Map<string, string | undefined>();
  steps.forEach((step, i) => {
    const fail = (code: string, params?: Record<string, string>) =>
      issues.push(issue(`steps.${i} (${step.id})`, code, params));
    const actions = actionsOf(step, ACTIONS);
    if (actions.length !== 1) {
      fail("step_one_action");
    }
    if (earlier.has(step.id)) fail("step_id_duplicate");
    const inner: Array<[string, RawInner]> = [
      ...(step.loop ? ([["loop.do", step.loop.do]] as Array<[string, RawInner]>) : []),
      ...(step.parallel ?? []).map((item, j): [string, RawInner] => [`parallel.${j}`, item]),
    ];
    for (const [path, item] of inner) {
      if (actionsOf(item, INNER_ACTIONS).length !== 1) {
        fail("inner_one_action", { where: path });
      }
    }
    const agents = [step.agent, ...inner.map(([, item]) => item.agent)];
    for (const agent of agents) {
      if (agent?.continue && earlier.get(agent.continue) !== "agent") {
        fail("continue_unknown", { step: agent.continue });
      }
      if (agent?.continue && agent.persona) {
        fail("persona_with_continue");
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
          fail("reference_unknown", { ref: raw });
        }
      }
    }
    earlier.set(step.id, actions.length === 1 ? actions[0] : undefined);
  });
  return issues;
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
