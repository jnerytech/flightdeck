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

const pad = (n: number) => String(n).padStart(2, "0");

/** `ms` as a `datetime-local` value, in this computer's time zone. */
function localInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) => (typeof value === "number" ? String(value) : "");

/** A rule the daemon accepted, as the editor holds it. */
export function draftOf(rule: unknown): RuleDraft {
  const r = rule as Record<string, unknown>;
  const match = (r.match ?? {}) as Record<string, unknown>;
  const window = r.window as { days: Day[]; from: string; to: string } | undefined;
  return {
    id: text(r.id),
    requester: text(match.requester) as RuleDraft["requester"],
    purpose: text(match.purpose) as RuleDraft["purpose"],
    action: text(match.action),
    host: text(match.host),
    tags: Array.isArray(match.tags) ? match.tags.join(", ") : "",
    project: text(match.project),
    session: text(match.session),
    decision: (text(r.decision) || "ask") as Decision,
    once: r.once === "session",
    days: window?.days ?? [],
    from: window?.from ?? "",
    to: window?.to ?? "",
    outsideWindow: (text(r.outsideWindow) || "deny") as Decision,
    maxPerHour: count(r.maxPerHour),
    maxPerDay: count(r.maxPerDay),
    expiresAt: typeof r.expiresAt === "number" ? localInput(r.expiresAt) : "",
  };
}

/** The rule the daemon reads: only the fields the draft sets. */
export function ruleOf(draft: RuleDraft): Record<string, unknown> {
  const tags = draft.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  const match = Object.fromEntries(
    Object.entries({
      requester: draft.requester,
      purpose: draft.purpose,
      action: draft.action.trim(),
      host: draft.host.trim(),
      project: draft.project.trim(),
      session: draft.session.trim(),
    }).filter(([, value]) => value !== ""),
  );
  const windowed = draft.days.length > 0 && draft.from !== "" && draft.to !== "";
  const hour = Number.parseInt(draft.maxPerHour, 10);
  const day = Number.parseInt(draft.maxPerDay, 10);
  return {
    id: draft.id,
    match: tags.length > 0 ? { ...match, tags } : match,
    decision: draft.decision,
    ...(draft.decision === "ask" && draft.once ? { once: "session" } : {}),
    ...(windowed
      ? {
          window: { days: draft.days, from: draft.from, to: draft.to },
          outsideWindow: draft.outsideWindow,
        }
      : {}),
    ...(Number.isInteger(hour) ? { maxPerHour: hour } : {}),
    ...(Number.isInteger(day) ? { maxPerDay: day } : {}),
    ...(draft.expiresAt ? { expiresAt: new Date(draft.expiresAt).getTime() } : {}),
  };
}

/** An empty rule (it matches everything and asks), with an id the list does not use. */
export function newDraft(existing: RuleDraft[]): RuleDraft {
  const used = existing.map((d) => /^r(\d+)$/.exec(d.id)?.[1]).filter((n) => n !== undefined);
  const next = Math.max(0, ...used.map(Number)) + 1;
  return {
    id: `r${next}`,
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
export function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
