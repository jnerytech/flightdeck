import type { Automation, AutomationAction, AutomationTrigger } from "@flightdeck/protocol";
import type { Key, T } from "../i18n/index.ts";

export type TriggerType = AutomationTrigger["type"];
export type ActionType = AutomationAction["type"];

/** The triggers, in the order the guided form offers them. */
export const TRIGGER_TYPES: TriggerType[] = ["cron", "pr_comment", "ci_failed", "issue_label"];

const ACTIONS: Record<TriggerType, ActionType[]> = {
  cron: ["start_workflow"],
  pr_comment: ["start_workflow", "send_to_card"],
  ci_failed: ["start_workflow", "send_to_card"],
  issue_label: ["start_workflow", "create_card"],
};

/** The actions a trigger can drive: the daemon refuses the other pairs. */
export function actionsFor(trigger: TriggerType): ActionType[] {
  return ACTIONS[trigger];
}

/** Whether what fires the trigger can come from someone else (a comment, an issue). */
export function carriesThirdParty(trigger: TriggerType): boolean {
  return trigger === "pr_comment" || trigger === "issue_label";
}

/** "Issue nova com o rótulo auto": what fires it, in words. */
export function triggerText(t: T, trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "cron":
      return t("automationsUi.trigger.cron", { expr: trigger.expr, tz: trigger.tz });
    case "issue_label":
      return t("automationsUi.trigger.issue_label", { label: trigger.label });
    default:
      return t(`automationsUi.trigger.${trigger.type}` as Key);
  }
}

/** "Iniciar o workflow revisar": what it does, in words. */
export function actionText(t: T, action: AutomationAction): string {
  return action.type === "start_workflow"
    ? t("automationsUi.action.start_workflow", { workflow: action.workflow })
    : t(`automationsUi.action.${action.type}` as Key);
}

/** The text a confirmation shows before an automation is turned on. */
export function confirmOnText(t: T, automation: Automation): string {
  return t("automationsUi.confirmOn", {
    name: automation.name,
    trigger: triggerText(t, automation.trigger),
    action: actionText(t, automation.action),
    limit: t("automationsUi.limit", { n: automation.maxRunsPerDay }),
  });
}
