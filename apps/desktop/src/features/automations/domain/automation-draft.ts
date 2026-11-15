import type { Automation, AutomationAction, AutomationTrigger } from "@flightdeck/protocol";
import type { ActionType, TriggerType } from "./automations.ts";

export const STEPS = ["trigger", "action", "limit"] as const;

export interface Draft {
  trigger: TriggerType;
  expr: string;
  tz: string;
  label: string;
  action: ActionType;
  workflow: string;
  name: string;
  max: string;
  external: boolean;
}

/**
 * The form's starting point: the saved automation, or a weekday morning schedule in `zone` (the
 * caller's time zone: the draft reads no ambient state).
 */
export function draftOf(initial: Automation | null, zone: string): Draft {
  const { trigger, action } = initial ?? {
    trigger: { type: "cron" as const, expr: "0 9 * * 1-5", tz: zone },
    action: { type: "start_workflow" as const, workflow: "" },
  };
  return {
    trigger: trigger.type,
    expr: trigger.type === "cron" ? trigger.expr : "0 9 * * 1-5",
    tz: trigger.type === "cron" ? trigger.tz : zone,
    label: trigger.type === "issue_label" ? trigger.label : "",
    action: action.type,
    workflow: action.type === "start_workflow" ? action.workflow : "",
    name: initial?.name ?? "",
    max: String(initial?.maxRunsPerDay ?? 10),
    external: initial?.allowExternalAuthors ?? false,
  };
}

export function triggerOf(draft: Draft): AutomationTrigger {
  switch (draft.trigger) {
    case "cron":
      return { type: "cron", expr: draft.expr.trim(), tz: draft.tz.trim() };
    case "issue_label":
      return { type: "issue_label", label: draft.label.trim() };
    default:
      return { type: draft.trigger };
  }
}

export function actionOf(draft: Draft, workflow: string): AutomationAction {
  return draft.action === "start_workflow"
    ? { type: "start_workflow", workflow }
    : { type: draft.action };
}
