/**
 * Phase 19: who may use which secret, and with what approval. A secret has an ordered list of
 * rules and the first that matches decides; without one the safe default of the case does. A rule
 * can loosen a default but never past the ceiling (no `allow` for `run_with_secret`, none for
 * `prod` without a time window), and a use the risk classifier calls high is always asked.
 */
import type { VaultRequester } from "@flightdeck/protocol";

export type Decision = "allow" | "ask" | "deny";
export type Purpose = "ssh" | "action" | "run_with_secret";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Risk = "low" | "medium" | "high";

export interface RuleWindow {
  days: Day[];
  /** `HH:MM`, in the PC's time zone. */
  from: string;
  /** `HH:MM`, exclusive; earlier than `from` means the window runs past midnight. */
  to: string;
}

export interface RuleMatch {
  requester?: VaultRequester;
  purpose?: Purpose;
  /** The action's name, with `*` as a wildcard. */
  action?: string;
  host?: string;
  /** Every tag listed has to be on the use. */
  tags?: string[];
  project?: string;
  session?: string;
}

export interface Rule {
  id: string;
  match: RuleMatch;
  decision: Decision;
  /** `ask` only: once approved, the same session is not asked again. */
  once?: "session";
  window?: RuleWindow;
  /** What the rule decides outside its window; `deny` when absent. */
  outsideWindow?: Decision;
  maxPerHour?: number;
  maxPerDay?: number;
  /** Milliseconds since the epoch. */
  expiresAt?: number;
}

/** One use of a secret, as the rules see it. */
export interface UseContext {
  secretId: string;
  requester: VaultRequester;
  purpose: Purpose;
  action?: string;
  host: string;
  /** The tags of the action (or SSH destination) and of the secret. */
  tags: string[];
  project?: string;
  session?: string;
  /** What the Phase 13 classifier says of the command. */
  risk?: Risk;
  /** What the action declares (`never` lets Claude run it without asking). */
  actionApproval?: "always" | "never" | "first-per-session";
}

export interface Verdict {
  decision: Decision;
  /** The rule that decided; null for the safe default. */
  ruleId: string | null;
  /** Why, in words the approval request can show. */
  reason: string;
  /** Ask once per session instead of every use. */
  once: boolean;
  /** The approval has to be held for 2 s and the tray cannot give it. */
  needsHold: boolean;
  /** A limit of the rule was reached. */
  limited: boolean;
}

export interface LocalTime {
  day: Day;
  /** Minutes since local midnight. */
  minutes: number;
}

export interface RulesEnv {
  now(): number;
  /** The local day and time of an instant. */
  local(ms: number): LocalTime;
  /** How many uses a rule has let through since `sinceMs`. */
  uses(ruleId: string, sinceMs: number): number;
}

/** The local day and time of an instant in `timeZone` (the PC's when absent). */
export function localTime(_ms: number, _timeZone?: string): LocalTime {
  return { day: "mon", minutes: 0 };
}

/** The rules that are valid, or why they are not (including what the ceiling refuses). */
export function validateRules(_raw: unknown): { rules: Rule[]; errors: string[] } {
  return { rules: [], errors: [] };
}

/** The decision for a use: the first rule that matches, else the safe default, under the ceiling. */
export function evaluate(_rules: readonly Rule[], _ctx: UseContext, _env: RulesEnv): Verdict {
  return {
    decision: "deny",
    ruleId: null,
    reason: "",
    once: false,
    needsHold: false,
    limited: false,
  };
}
