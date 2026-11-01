/**
 * Phase 19: who may use which secret, and with what approval. A secret has an ordered list of
 * rules and the first that matches decides; without one the safe default of the case does. A rule
 * can loosen a default but never past the ceiling (no `allow` for `run_with_secret`, none for
 * `prod` without a time window), and a use the risk classifier calls high is always asked.
 */
import {
  isProdTag,
  type RefusalParams,
  type RuleIssue,
  type VaultRequester,
} from "@flightdeck/protocol";

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

const DAY_ORDER: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const REQUESTERS: readonly string[] = ["you", "claude", "automation", "workflow"];
const PURPOSES: readonly string[] = ["ssh", "action", "run_with_secret"];
const DECISIONS: readonly string[] = ["allow", "ask", "deny"];
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The local day and time of an instant in `timeZone` (the PC's when absent). */
export function localTime(ms: number, timeZone?: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    day: part("weekday").toLowerCase().slice(0, 3) as Day,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM` as minutes; `24:00` is the end of the day (only as the end of a window). */
function clock(text: unknown, allowEnd: boolean): number | null {
  if (text === "24:00") return allowEnd ? 24 * 60 : null;
  const match = typeof text === "string" ? CLOCK.exec(text) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const MATCH_KEYS = new Set([
  "requester",
  "purpose",
  "action",
  "host",
  "tags",
  "project",
  "session",
]);
const RULE_KEYS = new Set([
  "id",
  "match",
  "decision",
  "once",
  "window",
  "outsideWindow",
  "maxPerHour",
  "maxPerDay",
  "expiresAt",
]);

/**
 * The rules that are valid, or what is wrong with them: one issue per problem, with a path
 * (`<rule index>.<field>`, the index from 0, empty for the list itself) and a code the app says in
 * its own language. The ceiling's issues are here too.
 */
export function validateRules(raw: unknown): { rules: Rule[]; errors: RuleIssue[] } {
  if (!Array.isArray(raw)) return { rules: [], errors: [{ path: "", code: "not_list" }] };
  const errors: RuleIssue[] = [];
  const rules: Rule[] = [];
  const ids = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      errors.push({ path: `${index}`, code: "not_object" });
      continue;
    }
    const bad = (field: string, code: string, params?: RefusalParams) => {
      errors.push({ path: `${index}.${field}`, code, ...(params ? { params } : {}) });
    };
    const before = errors.length;

    if (!isText(item.id)) bad("id", "required");
    else if (ids.has(item.id)) bad("id", "duplicate");
    else ids.add(item.id);
    for (const key of Object.keys(item)) if (!RULE_KEYS.has(key)) bad(key, "unknown_field");
    if (typeof item.decision !== "string" || !DECISIONS.includes(item.decision)) {
      bad("decision", "not_one_of", { allowed: DECISIONS.join(", ") });
    }

    const match = item.match === undefined ? {} : item.match;
    if (!isRecord(match)) bad("match", "not_object");
    else {
      for (const key of Object.keys(match)) {
        if (!MATCH_KEYS.has(key)) bad(`match.${key}`, "unknown_field");
      }
      if (match.requester !== undefined && !REQUESTERS.includes(match.requester as string)) {
        bad("match.requester", "not_one_of", { allowed: REQUESTERS.join(", ") });
      }
      if (match.purpose !== undefined && !PURPOSES.includes(match.purpose as string)) {
        bad("match.purpose", "not_one_of", { allowed: PURPOSES.join(", ") });
      }
      for (const key of ["action", "host", "project", "session"] as const) {
        if (match[key] !== undefined && !isText(match[key])) bad(`match.${key}`, "not_text");
      }
      if (match.tags !== undefined && !(Array.isArray(match.tags) && match.tags.every(isText))) {
        bad("match.tags", "not_list_of_text");
      }
    }

    if (item.once !== undefined && (item.once !== "session" || item.decision !== "ask")) {
      bad("once", "once_needs_ask");
    }

    const window = item.window;
    if (window !== undefined) {
      if (!isRecord(window)) bad("window", "not_object");
      else {
        const days = window.days;
        if (
          !Array.isArray(days) ||
          days.length === 0 ||
          !days.every((d) => DAY_ORDER.includes(d as Day))
        ) {
          bad("window.days", "not_one_of", { allowed: "mon, tue, wed, thu, fri, sat, sun" });
        }
        const from = clock(window.from, false);
        const to = clock(window.to, true);
        if (from === null) bad("window.from", "bad_time", { last: "23:59" });
        if (to === null) bad("window.to", "bad_time", { last: "24:00" });
        if (from !== null && from === to) bad("window.to", "same_time");
      }
    }
    if (
      item.outsideWindow !== undefined &&
      (typeof item.outsideWindow !== "string" || !DECISIONS.includes(item.outsideWindow))
    ) {
      bad("outsideWindow", "not_one_of", { allowed: DECISIONS.join(", ") });
    }
    if (item.outsideWindow !== undefined && window === undefined) {
      bad("outsideWindow", "outside_needs_window");
    }
    for (const key of ["maxPerHour", "maxPerDay"] as const) {
      const value = item[key];
      if (
        value !== undefined &&
        !(typeof value === "number" && Number.isInteger(value) && value > 0)
      ) {
        bad(key, "not_positive_int");
      }
    }
    if (
      item.expiresAt !== undefined &&
      !(typeof item.expiresAt === "number" && item.expiresAt > 0)
    ) {
      bad("expiresAt", "not_timestamp");
    }

    // The ceiling: what no rule can loosen.
    const targets = isRecord(match) ? match : {};
    const loosens = item.decision === "allow" || item.outsideWindow === "allow";
    if (targets.purpose === "run_with_secret" && loosens) {
      bad(item.decision === "allow" ? "decision" : "outsideWindow", "no_allow_run_with_secret");
    }
    const prodTagged =
      Array.isArray(targets.tags) && targets.tags.some((tag) => isProdTag(String(tag)));
    if (
      prodTagged &&
      (item.outsideWindow === "allow" || (item.decision === "allow" && window === undefined))
    ) {
      bad(item.outsideWindow === "allow" ? "outsideWindow" : "window", "prod_needs_window");
    }

    if (errors.length === before) rules.push(item as unknown as Rule);
  }
  if (errors.length > 0) return { rules: [], errors };
  return { rules: rules.map((rule) => ({ ...rule, match: rule.match ?? {} })), errors };
}

/** `deploy-*` against a name: `*` is the only wildcard, everything else is literal. */
function wildcard(pattern: string, text: string): boolean {
  if (!pattern.includes("*")) return pattern === text;
  const pieces = pattern.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${pieces.join(".*")}$`).test(text);
}

function matches(match: RuleMatch, ctx: UseContext): boolean {
  if (match.requester !== undefined && match.requester !== ctx.requester) return false;
  if (match.purpose !== undefined && match.purpose !== ctx.purpose) return false;
  if (
    match.action !== undefined &&
    !(ctx.action !== undefined && wildcard(match.action, ctx.action))
  ) {
    return false;
  }
  if (match.host !== undefined && match.host !== ctx.host) return false;
  if (match.project !== undefined && match.project !== ctx.project) return false;
  if (match.session !== undefined && match.session !== ctx.session) return false;
  if (match.tags !== undefined) {
    const have = new Set(ctx.tags.map((tag) => tag.toLowerCase()));
    if (!match.tags.every((tag) => have.has(tag.toLowerCase()))) return false;
  }
  return true;
}

function insideWindow(window: RuleWindow, at: LocalTime): boolean {
  const from = clock(window.from, false) as number;
  const to = clock(window.to, true) as number;
  if (from < to) return window.days.includes(at.day) && at.minutes >= from && at.minutes < to;
  // Past midnight: the days are the ones the window starts on.
  if (at.minutes >= from) return window.days.includes(at.day);
  if (at.minutes < to) {
    const before = DAY_ORDER[(DAY_ORDER.indexOf(at.day) + 6) % 7] as Day;
    return window.days.includes(before);
  }
  return false;
}

const verdict = (over: Partial<Verdict> & Pick<Verdict, "decision" | "reason">): Verdict => ({
  ruleId: null,
  once: false,
  needsHold: false,
  limited: false,
  ...over,
});

/** The safe default of a use no rule matched. */
function fallback(ctx: UseContext): Verdict {
  if (ctx.requester === "you") {
    return verdict({ decision: "allow", reason: "padrão: o uso por você no app é liberado" });
  }
  if (ctx.requester !== "claude") {
    return verdict({
      decision: "deny",
      reason: `padrão: ${ctx.requester} não usa segredos sem uma regra que permita`,
    });
  }
  if (ctx.purpose === "run_with_secret") {
    return verdict({
      decision: "ask",
      reason: "padrão: o app pede a sua aprovação a cada run_with_secret",
    });
  }
  if (ctx.actionApproval === "never") {
    return verdict({ decision: "allow", reason: "padrão: a ação declara approval never" });
  }
  if (ctx.actionApproval === "always") {
    return verdict({
      decision: "ask",
      reason: "padrão: a ação declara approval always, o app pede a cada uso",
    });
  }
  return verdict({
    decision: "ask",
    once: true,
    reason: "padrão: o app pede a sua aprovação uma vez por sessão",
  });
}

/** What the rule says for the moment: its decision, or the one outside its window. */
function ruleVerdict(rule: Rule, env: RulesEnv): Verdict & { inWindow: boolean } {
  const now = env.now();
  let decision = rule.decision;
  let once = rule.once === "session";
  let reason = `regra ${rule.id}: ${rule.decision}`;
  let inWindow = false;
  if (rule.window) {
    if (insideWindow(rule.window, env.local(now))) inWindow = true;
    else {
      decision = rule.outsideWindow ?? "deny";
      once = false;
      reason = `regra ${rule.id}: fora da janela ${rule.window.from}–${rule.window.to}, vale ${decision}`;
    }
  }
  if (decision !== "deny") {
    const limits: Array<[number | undefined, number, string]> = [
      [rule.maxPerHour, HOUR_MS, "por hora"],
      [rule.maxPerDay, DAY_MS, "por dia"],
    ];
    for (const [max, span, label] of limits) {
      if (max !== undefined && env.uses(rule.id, now - span) >= max) {
        return {
          ...verdict({
            ruleId: rule.id,
            decision: "deny",
            limited: true,
            reason: `regra ${rule.id}: o limite de ${max} ${label} foi atingido; vale de novo quando o período virar`,
          }),
          inWindow,
        };
      }
    }
  }
  return {
    ...verdict({ ruleId: rule.id, decision, once: decision === "ask" && once, reason }),
    inWindow,
  };
}

/** The decision for a use: the first rule that matches, else the safe default, under the ceiling. */
export function evaluate(rules: readonly Rule[], ctx: UseContext, env: RulesEnv): Verdict {
  const now = env.now();
  const rule = rules.find(
    (r) => (r.expiresAt === undefined || r.expiresAt > now) && matches(r.match, ctx),
  );
  const { inWindow, ...found } = rule
    ? ruleVerdict(rule, env)
    : { ...fallback(ctx), inWindow: false };
  // A denial stands. The owner is not held to the ceiling, which guards against the others.
  if (found.decision === "deny" || ctx.requester === "you") return found;

  const out = { ...found };
  const raise = (why: string) => {
    out.decision = "ask";
    out.once = false;
    out.reason = `${out.reason}; ${why}`;
  };
  if (ctx.purpose === "run_with_secret" && (out.decision === "allow" || out.once)) {
    raise("o run_with_secret pede a sua aprovação a cada uso");
  }
  const prod = ctx.tags.some(isProdTag);
  if (prod) {
    if (out.decision === "allow" && !inWindow) raise("prod pede a sua aprovação a cada uso");
    // A rule may say once per session; prod still asks at every use, so a session approval
    // (this one's, or another use's under the same rule) never stands in for the held button.
    else if (out.decision === "ask" && (out.once || !rule)) {
      out.once = false;
      out.reason = `${out.reason}; prod pede a sua aprovação a cada uso`;
    }
  }
  const high = ctx.risk === "high";
  if (high && (out.decision === "allow" || out.once)) {
    raise("risco alto pede a sua aprovação a cada uso");
  }
  out.needsHold = out.decision === "ask" && (prod || high);
  return out;
}
