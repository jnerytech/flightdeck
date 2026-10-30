import type { AutomationAction, AutomationTrigger } from "@flightdeck/protocol";

export type TriggerType = AutomationTrigger["type"];
export type ActionType = AutomationAction["type"];

/** The triggers, in the order the guided form offers them. */
export const TRIGGER_TYPES: TriggerType[] = ["cron", "pr_comment", "ci_failed", "issue_label"];

/** The actions a trigger can drive: the daemon refuses the other pairs. */
export function actionsFor(_trigger: TriggerType): ActionType[] {
  return [];
}

/** Whether what fires the trigger can come from someone else (a comment, an issue). */
export function carriesThirdParty(_trigger: TriggerType): boolean {
  return false;
}
