import type {
  Automation,
  AutomationAction,
  AutomationRun,
  AutomationTrigger,
} from "@flightdeck/protocol";
import type { Key, T } from "../../../i18n/index.ts";
import { ptBR } from "../../../i18n/pt-BR.ts";

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

type Params = Record<string, string | number>;

/** A sentence of the dictionary `group` for the run's `code`, or the text the host stored: a row from before the codes, or a code this app does not know yet. */
function said(
  t: T,
  group: "runCause" | "runDetail",
  code: string | null | undefined,
  params: Params | null | undefined,
  stored: string,
): string {
  if (!code || !(code in ptBR.automationsUi[group])) return stored;
  return t(`automationsUi.${group}.${code}` as Key, params ?? {});
}

/** What fired a run, in the app's language; a time in it is shown in the app's format, not as the ISO text. */
export function causeText(t: T, formatTime: (iso: string) => string, run: AutomationRun): string {
  const at = run.causeParams?.at;
  const params =
    typeof at === "string" ? { ...run.causeParams, at: formatTime(at) } : run.causeParams;
  return said(t, "runCause", run.causeCode, params, run.cause);
}

/** What a run did or why it did not, in the app's language; a failed run's own message stays as the host wrote it. */
export function detailText(t: T, run: AutomationRun): string {
  return said(t, "runDetail", run.detailCode, run.detailParams, run.detail ?? "");
}
