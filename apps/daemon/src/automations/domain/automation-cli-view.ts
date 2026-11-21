/**
 * Issue #3627: what `flightdeckd automation` prints, as pure rules over the daemon's answers. A `--json`
 * value keeps every key (`null` where an action leaves a field out) and the daemon's answer whole. Names,
 * labels and details are text a person or a repository wrote: `shown` strips the control characters.
 */
import type { Automation, AutomationRun } from "@flightdeck/protocol";

/** An action with the optional fields of `start_workflow` as `null`, so the keys are the same every time. */
const actionJson = (action: Automation["action"]) =>
  action.type === "start_workflow"
    ? {
        ...action,
        inputs: action.inputs ?? null,
        title: action.title ?? null,
        description: action.description ?? null,
      }
    : action;

export const listJson = (automations: readonly Automation[]) => ({
  automations: automations.map((automation) => ({
    ...automation,
    action: actionJson(automation.action),
  })),
});

export const runsJson = (runs: readonly AutomationRun[]) => ({
  runs: runs.map((run) => ({ ...run, detail: run.detail ?? null })),
});

function triggerText(trigger: Automation["trigger"]): string {
  switch (trigger.type) {
    case "cron":
      return `cron ${trigger.expr} (${trigger.tz})`;
    case "pr_comment":
      return "PR comment";
    case "ci_failed":
      return "checks fail";
    case "issue_label":
      return `issue labeled ${trigger.label}`;
  }
}

function actionText(action: Automation["action"]): string {
  switch (action.type) {
    case "start_workflow":
      return `start workflow ${action.workflow}`;
    case "send_to_card":
      return "send to card";
    case "create_card":
      return "create card";
  }
}

/** One line for an automation: its id, name and state, what fires it, what it does and how often it may. */
function automationLine(automation: Automation): string {
  const parts = [
    automation.name,
    automation.enabled ? "on" : "off",
    triggerText(automation.trigger),
    actionText(automation.action),
    `up to ${automation.maxRunsPerDay} runs a day`,
  ];
  if (automation.allowExternalAuthors) parts.push("external authors allowed");
  return `${automation.id}: ${parts.join(", ")}`;
}

/** A project's automations, one line each; a project with none says so. */
export function listLines(project: string, automations: readonly Automation[]): string[] {
  if (automations.length === 0) return [`${project}: no automations`];
  return automations.map(automationLine);
}

/** An automation's runs, newest first as the daemon sends them: the time, the status, the cause and the detail. */
export function runsLines(id: string, runs: readonly AutomationRun[]): string[] {
  if (runs.length === 0) return [`${id}: no runs`];
  return [
    `${id}: ${runs.length} runs`,
    ...runs.map((run) => {
      const detail = run.detail ? `: ${run.detail}` : "";
      return `  ${run.firedAt} ${run.status}, ${run.cause}${detail}`;
    }),
  ];
}
