/** Issue #3628: what `flightdeckd workflow` prints, as pure functions of what the daemon answered. */
import type {
  RunResumeCheck,
  WorkflowInfo,
  WorkflowRun,
  WorkflowTemplate,
  WorkflowTemplateAdded,
} from "@flightdeck/protocol";

/** `invalid` (it has errors, so it can be neither trusted nor run), `trusted` or `untrusted`. */
const stateOf = (info: WorkflowInfo) => {
  if (info.errors.length > 0) return "invalid";
  return info.trusted ? "trusted" : "untrusted";
};

const errorLines = (info: WorkflowInfo) => info.errors.map((error) => `  error: ${error}`);

/** One workflow in a listing: its summary line, then its errors. The hash is whole: trust is given to it. */
function summary(info: WorkflowInfo): string[] {
  const inputs = info.inputs.length > 0 ? info.inputs.join(", ") : "none";
  return [
    `${info.name}  ${info.hash}  ${stateOf(info)}  checks: ${info.checks.length}  inputs: ${inputs}`,
    ...errorLines(info),
  ];
}

export const listLines = (workflows: WorkflowInfo[]): string[] =>
  workflows.length === 0
    ? ["no workflow in .flightdeck/workflows on the base branch"]
    : workflows.flatMap(summary);

/** One workflow in full: what it asks for, the shell commands it can run, and what is wrong with it. */
export const infoLines = (info: WorkflowInfo): string[] => [
  `${info.name}  ${info.hash}  ${stateOf(info)}`,
  ...info.inputs.map((input) => `  input: ${input}`),
  ...info.checks.map((check) => `  check: ${check}`),
  ...errorLines(info),
];

const checkWord = (filled: boolean | null) => {
  if (filled === null) return "none";
  return filled ? "filled" : "placeholder";
};

export const templatesLines = (templates: WorkflowTemplate[]): string[] =>
  templates.map(
    (t) =>
      `${t.id}  ${t.title.en}  ${t.path}  persona: ${t.persona}  check: ${checkWord(t.checkFilled)}`,
  );

const minutes = (value: number) => Number(value.toFixed(1));

/** A run: its state and why, what it spent, when it waits for the quota, and each step. */
export function runLines(run: WorkflowRun): string[] {
  const { usage } = run;
  return [
    `${run.id}  ${run.workflowName}  ${run.status}  card ${run.cardId}`,
    ...(run.statusReason ? [`  reason: ${run.statusReason}`] : []),
    `  spent: ${usage.turns} turns, ${minutes(usage.minutes)} min, $${usage.costUsd.toFixed(2)}`,
    ...(run.quotaUntil ? [`  waiting for the plan quota until ${run.quotaUntil}`] : []),
    ...run.steps.map((s) => {
      const exit = s.exitCode === null ? "" : `  exit ${s.exitCode}`;
      return `  ${s.stepId} #${s.attempt}  ${s.type}  ${s.status}${exit}`;
    }),
  ];
}

/** What `watch` writes for a change of a run: its state, the step it is at and the reason. */
export function watchLine(run: WorkflowRun): string {
  const last = run.steps.at(-1);
  const at = last ? `${last.stepId} ${last.status}` : "no step yet";
  const reason = run.statusReason ? `  ${run.statusReason}` : "";
  return `${run.id}  ${run.workflowName}  ${run.status}  ${at}${reason}`;
}

export function resumeLines(runId: string, check: RunResumeCheck): string[] {
  if (check.ok) return [`${runId} can resume from ${check.from}`];
  const params = Object.entries(check.params ?? {}).map(([key, value]) => `${key}: ${value}`);
  const shown = params.length > 0 ? ` (${params.join(", ")})` : "";
  return [`${runId} cannot resume: ${check.reason ?? "no reason given"}${shown}`];
}

/** A resume that went ahead says from which step; one the daemon refused says why, as the check does. */
export const resumedLines = (runId: string, check: RunResumeCheck): string[] =>
  check.ok ? [`${runId} resumed from ${check.from}`] : resumeLines(runId, check);

/** Where a template went: its file, the new branch and the base the PR targets, then the PR. */
export const templateAddedLines = (added: WorkflowTemplateAdded): string[] => [
  `${added.path}  branch ${added.branch}  base ${added.base}`,
  `pr  ${added.url}`,
];

/** What a lost connection leaves open, per verb: what may have happened, and how to look before running it again. */
export const UNSURE_WORKFLOW = {
  trust:
    "; the trust may or may not have been given: workflow list shows it, and trusting the same hash again is safe",
  "template-add":
    "; the branch and its PR may or may not have been made: look at the project's branches before you run it again",
  resume:
    "; the run may or may not have resumed: workflow run shows it, so look before you resume it again",
} as const;
