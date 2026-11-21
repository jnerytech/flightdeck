import type { CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import type { Key, T } from "../../../i18n/index.ts";

/** The origins the Origin filter offers, in the order it lists them. */
const FILTER_ORIGINS: readonly UsageOrigin[] = ["terminal", "app", "card", "workflow", "subagent"];

/** The dictionary key of each origin the daemon reports. */
const ORIGIN_KEYS: Record<UsageOrigin, Key> = {
  terminal: "costsUi.origins.terminal",
  app: "costsUi.origins.app",
  card: "costsUi.origins.card",
  workflow: "costsUi.origins.workflow",
  subagent: "costsUi.origins.subagent",
  "auto-approve": "costsUi.origins.autoApprove",
  assistant: "costsUi.origins.assistant",
};

/** A usage origin's name in the language of `t`; an id the dictionary does not know shows as it is. */
export function originLabel(origin: string, t: T): string {
  return Object.hasOwn(ORIGIN_KEYS, origin) ? t(ORIGIN_KEYS[origin as UsageOrigin]) : origin;
}

/** The Origin filter's options: the id the daemon filters on, and the name the person reads. */
export function originOptions(t: T): { value: UsageOrigin; label: string }[] {
  return FILTER_ORIGINS.map((value) => ({ value, label: originLabel(value, t) }));
}

/** The rows of the "By origin" breakdown, each named in the language of `t`. */
export function originRows(
  byOrigin: CostsSummary["byOrigin"],
  t: T,
): { label: string; costUsd: number }[] {
  return byOrigin.map((o) => ({ label: originLabel(o.origin, t), costUsd: o.costUsd }));
}
