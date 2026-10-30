/**
 * Phase 19: a secret's rule as the editor holds it (text fields) and as the daemon reads it. The
 * daemon validates the rules and applies the ceiling; this only shapes them.
 */

export type Decision = "allow" | "ask" | "deny";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const REQUESTERS = ["you", "claude", "automation", "workflow"] as const;
export const PURPOSES = ["ssh", "action", "run_with_secret"] as const;
export const DECISIONS: Decision[] = ["allow", "ask", "deny"];

export interface RuleDraft {
  id: string;
  /** "" matches any. */
  requester: "" | (typeof REQUESTERS)[number];
  purpose: "" | (typeof PURPOSES)[number];
  action: string;
  host: string;
  /** Comma-separated. */
  tags: string;
  project: string;
  session: string;
  decision: Decision;
  /** Ask once per session (only with `ask`). */
  once: boolean;
  /** No day: no window. */
  days: Day[];
  from: string;
  to: string;
  outsideWindow: Decision;
  maxPerHour: string;
  maxPerDay: string;
  /** A `datetime-local` value; "" for none. */
  expiresAt: string;
}

/** A rule the daemon accepted, as the editor holds it. */
export function draftOf(_rule: unknown): RuleDraft {
  return newDraft([]);
}

/** The rule the daemon reads: only the fields the draft sets. */
export function ruleOf(_draft: RuleDraft): Record<string, unknown> {
  return {};
}

/** An empty rule (it matches everything and asks), with an id the list does not use. */
export function newDraft(_existing: RuleDraft[]): RuleDraft {
  return {
    id: "",
    requester: "",
    purpose: "",
    action: "",
    host: "",
    tags: "",
    project: "",
    session: "",
    decision: "ask",
    once: false,
    days: [],
    from: "",
    to: "",
    outsideWindow: "deny",
    maxPerHour: "",
    maxPerDay: "",
    expiresAt: "",
  };
}

/** The list with the item at `from` moved to `to`. */
export function move<T>(list: T[], _from: number, _to: number): T[] {
  return list;
}
