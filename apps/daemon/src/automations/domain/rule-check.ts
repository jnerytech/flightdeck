import type { Automation, AutomationRun } from "@flightdeck/protocol";
import { type CronError, parseCron, validTimeZone } from "./cron.ts";
import { type AutomationEvent, isExternal } from "./event.ts";

/** Why a rule can never work: the message, the dictionary key and what fills it in. */
export interface RuleProblem {
  message: string;
  reason: string;
  params?: Record<string, string | number>;
}

/** What the rule refuses to do with an event, recorded in its history instead of acting. */
export interface Refusal {
  status: Extract<AutomationRun["status"], "ignored" | "limited">;
  detail: string;
}

/** What the automation could never do: a cron or time zone that does not parse, or an action its trigger cannot feed. */
export function ruleProblem(
  trigger: Automation["trigger"],
  action: Automation["action"],
): RuleProblem | null {
  if (trigger.type === "cron") {
    try {
      parseCron(trigger.expr);
    } catch (error) {
      const cron = error as CronError;
      return { message: cron.message, reason: cron.reason, params: cron.params };
    }
    if (!validTimeZone(trigger.tz)) {
      return {
        message: `unknown time zone: ${trigger.tz}`,
        reason: "automation_tz_unknown",
        params: { tz: trigger.tz },
      };
    }
  }
  if (
    action.type === "send_to_card" &&
    trigger.type !== "pr_comment" &&
    trigger.type !== "ci_failed"
  ) {
    return {
      message: "send_to_card needs a trigger with a card: pr_comment or ci_failed",
      reason: "automation_send_needs_card",
    };
  }
  if (action.type === "create_card" && trigger.type !== "issue_label") {
    return {
      message: "create_card needs the issue_label trigger",
      reason: "automation_create_needs_label",
    };
  }
  return null;
}

/**
 * Whether the automation acts on an event or leaves it: a third party's content only when the
 * automation allows it, then the daily limit. `today` is asked only when the first check passes.
 */
export function refusal(
  auto: Pick<Automation, "allowExternalAuthors" | "maxRunsPerDay">,
  event: AutomationEvent,
  today: () => number,
): Refusal | null {
  if (isExternal(event) && !auto.allowExternalAuthors) {
    return {
      status: "ignored",
      detail: "external author: the automation does not act on third-party content",
    };
  }
  if (today() >= auto.maxRunsPerDay) {
    return { status: "limited", detail: `limit of ${auto.maxRunsPerDay} runs per day` };
  }
  return null;
}
