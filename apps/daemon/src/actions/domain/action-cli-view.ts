/**
 * Issue #3629: what `flightdeckd action list --json|--plain` and `action runs` print, as pure rules over the
 * daemon's answers. The list shows what a person needs to decide on an action (its state and the hash to
 * trust) and never what it runs: no command, environment, working folder or secret. The output of a run is
 * masked by the daemon; it is still text a program wrote, so `said` strips the control characters, and the
 * lines are split here because that strips the line breaks too.
 */
import type { ActionInfo, ActionRunInfo } from "@flightdeck/protocol";

/** One action as `--json` prints it: the same keys every time. */
const actionJson = (action: ActionInfo) => ({
  name: action.name,
  description: action.description,
  approval: action.approval,
  params: action.params,
  hash: action.hash,
  trusted: action.trusted,
  changed: action.changed,
});

export const listJson = (actions: readonly ActionInfo[]) => ({ actions: actions.map(actionJson) });

export const runsJson = (runs: readonly ActionRunInfo[]) => ({ runs });

/** "a", "a and b", "a, b and c". */
function joined(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** One line for an action: its state, how it asks for approval and the hash that `trust` takes. */
function actionLine(action: ActionInfo): string {
  const parts = [
    action.description,
    action.trusted ? "trusted" : "not trusted",
    `approval ${action.approval}`,
    `hash ${action.hash}`,
  ];
  if (action.changed.length > 0) parts.push(`changed ${joined(action.changed)}`);
  return `${action.name}: ${parts.join(", ")}`;
}

export function listLines(actions: readonly ActionInfo[]): string[] {
  return actions.length === 0 ? ["no actions"] : actions.map(actionLine);
}

/** A run's header, then its output indented under it. */
function runLines(run: ActionRunInfo): string[] {
  const ending = [`exit ${run.exitCode} in ${run.durationMs} ms`];
  if (run.timedOut) ending.push("timed out");
  if (run.truncated) ending.push("output cut");
  const output = run.output.trimEnd();
  return [
    `  ${run.startedAt} ${run.name} by ${run.requestedBy}, ${ending.join(", ")}`,
    ...(output === "" ? [] : output.split("\n").map((line) => `    ${line}`)),
  ];
}

/** The runs as the daemon sends them (newest first), or a line saying there are none. */
export function runsLines(runs: readonly ActionRunInfo[]): string[] {
  if (runs.length === 0) return ["no runs"];
  return [`${runs.length} runs`, ...runs.flatMap(runLines)];
}
