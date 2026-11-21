import type { CostsSummary, UsageOrigin } from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";

/** The origins the Origin filter offers, in the order it lists them. */
export const FILTER_ORIGINS: readonly UsageOrigin[] = [
  "terminal",
  "app",
  "card",
  "workflow",
  "subagent",
];

/** A usage origin's name in the language of `t`; an id the dictionary does not know shows as it is. */
export function originLabel(origin: string, t: T): string {
  return origin;
}

/** The Origin filter's options: the id the daemon filters on, and the name the person reads. */
export function originOptions(t: T): { value: UsageOrigin; label: string }[] {
  return [];
}

/** The rows of the "By origin" breakdown, each named in the language of `t`. */
export function originRows(
  byOrigin: CostsSummary["byOrigin"],
  t: T,
): { label: string; costUsd: number }[] {
  return byOrigin.map((o) => ({ label: o.origin, costUsd: o.costUsd }));
}
