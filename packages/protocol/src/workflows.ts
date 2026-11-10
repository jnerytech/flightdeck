// The workflows of a card: their steps (agent, check, gate), runs, budgets and templates (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { LocalizedText } from "./localized-text.ts";

// Phase 6: workflows declared in `.flightdeck/workflows/<name>.yaml` on the base branch.
export const WorkflowInfo = z.object({
  /** The file name without `.yaml`. */
  name: z.string(),
  /** sha256 of the file on the base branch; trust is given to this exact content. */
  hash: z.string(),
  trusted: z.boolean(),
  /** Every `check` command, the only shell commands the workflow can run. */
  checks: z.array(z.string()),
  /** Validation errors; a workflow with any can neither be trusted nor run. */
  errors: z.array(z.string()),
  /** The same problems as codes with params, for the app to translate. */
  issues: z
    .array(
      z.object({
        path: z.string(),
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
  inputs: z.array(z.string()),
});
export type WorkflowInfo = z.infer<typeof WorkflowInfo>;

/**
 * Issue #79: a workflow that ships with the product, to copy into `.flightdeck/workflows/` and
 * commit to the base branch (the host never writes there; trust stays on the Workflows screen).
 */
export const WorkflowTemplate = z.object({
  id: z.string(),
  title: LocalizedText,
  description: LocalizedText,
  /** What bounds a run: rounds, budget, cards, where it stops for approval. */
  limits: LocalizedText,
  /** The persona the template's agent steps run in. */
  persona: z.string(),
  inputs: z.array(z.string()),
  /** Where to commit the file, relative to the repository. */
  path: z.string(),
  yaml: z.string(),
  /** The `check` line: true when it holds the project's own test command, false when it holds a placeholder that fails, null when the template has none. */
  checkFilled: z.boolean().nullable(),
});
export type WorkflowTemplate = z.infer<typeof WorkflowTemplate>;

/** Issue #1221: where the template went: its file, the new branch, the base the PR targets, the PR. */
export const WorkflowTemplateAdded = z.object({
  path: z.string(),
  branch: z.string(),
  base: z.string(),
  url: z.string(),
});
export type WorkflowTemplateAdded = z.infer<typeof WorkflowTemplateAdded>;

/**
 * `waiting`: a gate is open. `paused`: budget or loop limit reached. `failed`: a step (or the
 * card's preparation) failed. The last four are final.
 */
export const RunStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "paused",
  "failed",
  "rejected",
  "completed",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepType = z.enum(["agent", "check", "gate", "loop", "parallel", "pr", "cards"]);
export type StepType = z.infer<typeof StepType>;

export const StepStatus = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "approved",
  "rejected",
]);
export type StepStatus = z.infer<typeof StepStatus>;

/**
 * One attempt of one step. Inside a loop the check is `<id>.check` and the action `<id>.do`,
 * with the iteration as attempt; parallel items are `<id>.<index>`.
 */
export const StepRun = z.object({
  stepId: z.string(),
  attempt: z.number().int().min(1),
  type: StepType,
  status: StepStatus,
  /** Session of an `agent` step: its conversation. */
  sessionId: z.string().nullable(),
  /** Assistant text of the turn, the last 8 KB of a check, the text shown by a gate. */
  output: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  /** The note given when answering a gate. */
  note: z.string().nullable(),
  /** The question of a gate. */
  message: z.string().nullable(),
  /** What the turns of an `agent` step spent; `null` for the other steps. */
  usage: z
    .object({
      turns: z.number().int().nonnegative(),
      minutes: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type StepRun = z.infer<typeof StepRun>;

export const RunBudget = z.object({
  maxTurns: z.number().optional(),
  maxMinutes: z.number().optional(),
  maxCostUsd: z.number().optional(),
});
export type RunBudget = z.infer<typeof RunBudget>;

/** Summed over every session of the run; the cost is what the SDK reports (an estimate). */
export const RunUsage = z.object({
  turns: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type RunUsage = z.infer<typeof RunUsage>;

export const WorkflowRun = z.object({
  id: z.string(),
  cardId: z.string(),
  workflowName: z.string(),
  workflowHash: z.string(),
  status: RunStatus,
  statusReason: z.string().nullable(),
  /** Why, when the run ended on a refusal: the app translates it, `statusReason` is the fallback. */
  reasonKey: z.string().nullable().optional(),
  reasonParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable()
    .optional(),
  budget: RunBudget,
  usage: RunUsage,
  inputs: z.record(z.string(), z.string()),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** In the order they started. */
  steps: z.array(StepRun),
  /** Waiting for the plan quota before the next agent turn: until when (ISO) (phase 7). */
  quotaUntil: z.string().nullable().default(null),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

/** #1266: whether a failed run can resume, from which step, and the reason when it cannot. */
export const RunResumeCheck = z.object({
  from: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
});
export type RunResumeCheck = z.infer<typeof RunResumeCheck>;

export const GateRespondPayload = z.object({
  runId: z.string(),
  stepId: z.string().min(1),
  attempt: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});

export const RunUpdated = z.object({ type: z.literal("run.updated"), run: WorkflowRun });
export type RunUpdated = z.infer<typeof RunUpdated>;

/** The workflows commands; index.ts spreads them into `Command`. */
export const workflowsCommands = [
  // Phase 6: workflows of a project (read from its base branch) and their runs.
  cmd("workflow.list", z.object({ projectId: z.string() })),
  /** Issue #79: the workflow templates, with the check line filled from the project's stack. */
  cmd("workflow.templates", z.object({ projectId: z.string() })),
  /**
   * Issue #1221: the host commits one of its own templates (by id; the app sends no file and no
   * path) on a new branch of the project and opens its PR, as a card does. Never the base branch:
   * the file is listed, untrusted, once the PR is merged. Refused without `confirm: true`.
   */
  cmd(
    "workflow.template.add",
    z
      .object({
        projectId: z.string(),
        templateId: z.string().min(1).max(200),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("workflow.validate", z.object({ projectId: z.string(), name: z.string().min(1) })),
  /** `hash` is the content the user reviewed; a workflow that changed since is refused. */
  cmd(
    "workflow.trust",
    z.object({ projectId: z.string(), name: z.string().min(1), hash: z.string().min(1) }),
  ),
  cmd("run.get", z.object({ runId: z.string() })),
  cmd("run.watch", z.object({}).strict()),
  /**
   * #1266: whether a failed run can resume from its failed step (`from`), and why not; with
   * `confirm`, resumes it (near only: it runs the project's commands again).
   */
  cmd(
    "run.resume",
    z.object({ runId: z.string().min(1), confirm: z.boolean().optional() }).strict(),
  ),
  /** Only the user answers gates: there is no MCP tool for it. */
  cmd("gate.respond", GateRespondPayload),
] as const;

/** The `data` of each workflows command's ack; `CommandResults` extends it. */
export interface WorkflowsResults {
  "workflow.list": { workflows: WorkflowInfo[] };
  "workflow.templates": { templates: WorkflowTemplate[] };
  "workflow.template.add": WorkflowTemplateAdded;
  "workflow.validate": WorkflowInfo;
  "workflow.trust": WorkflowInfo;
  "run.get": WorkflowRun;
  "run.watch": undefined;
  "gate.respond": WorkflowRun;
  "run.resume": RunResumeCheck;
}
