/**
 * Phase 21: who may message whom, and how much. By default only sessions of the same project or
 * of the same team talk; exceptions add pairs, in one direction or both. Size, the rate per pair
 * and per session, and the back and forth between a pair are limited. Everything here is pure:
 * the history and the clock are handed in.
 */

/** A session as the rules see it. */
export interface Party {
  id: string;
  host: string;
  name: string | null;
  persona: string | null;
  projectKey: string | null;
  teamId: string | null;
}

/** `<host>/<id>`: how a session is addressed from any host. */
export const addressOf = (party: Pick<Party, "host" | "id">): string => `${party.host}/${party.id}`;

/** Which sessions an exception names; every field given has to match. */
export interface Selector {
  /** An address (`host/id`) or a bare id. */
  session?: string;
  project?: string;
  team?: string;
  host?: string;
}

/** Lets `from` talk to `to` (and the other way too with `bothWays`). */
export interface Exception {
  id: string;
  from: Selector;
  to: Selector;
  bothWays?: boolean;
}

export interface Policy {
  exceptions: Exception[];
  perPairPerHour: number;
  perSessionPerHour: number;
  /** More than this many messages between a pair... */
  loopMessages: number;
  /** ...within this many minutes pause the pair. */
  loopMinutes: number;
  /** Days the history is kept for the conversations screen. */
  retentionDays: number;
}

export const DEFAULT_POLICY: Policy = {
  exceptions: [],
  perPairPerHour: 20,
  perSessionPerHour: 100,
  loopMessages: 10,
  loopMinutes: 10,
  retentionDays: 0,
};

/** A message above this many bytes is refused. */
export const MAX_TEXT_BYTES = 32 * 1024;

export type Access =
  | { ok: true; via: "project" | "team" | "exception" }
  | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const SELECTOR_KEYS = ["session", "project", "team", "host"] as const;
const POLICY_KEYS = new Set([
  "exceptions",
  "perPairPerHour",
  "perSessionPerHour",
  "loopMessages",
  "loopMinutes",
]);

/** The policy that is valid, or why it is not. */
export function validatePolicy(raw: unknown): { policy: Policy; errors: string[] } {
  if (raw === undefined) return { policy: DEFAULT_POLICY, errors: [] };
  if (!isRecord(raw)) return { policy: DEFAULT_POLICY, errors: ["a política é um objeto"] };
  const errors: string[] = [];
  for (const key of Object.keys(raw))
    if (!POLICY_KEYS.has(key)) errors.push(`campo desconhecido: ${key}`);
  const numbers: Partial<Record<keyof Policy, number>> = {};
  for (const key of [
    "perPairPerHour",
    "perSessionPerHour",
    "loopMessages",
    "loopMinutes",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isInteger(value) && value > 0) numbers[key] = value;
    else errors.push(`${key} é um inteiro positivo`);
  }
  const exceptions: Exception[] = [];
  const given = raw.exceptions;
  if (given !== undefined && !Array.isArray(given)) errors.push("exceptions é uma lista");
  const ids = new Set<string>();
  for (const [index, item] of (Array.isArray(given) ? given : []).entries()) {
    const label = `exceção #${index + 1}`;
    if (!isRecord(item)) {
      errors.push(`${label}: tem de ser um objeto`);
      continue;
    }
    const before = errors.length;
    if (typeof item.id !== "string" || item.id === "") errors.push(`${label}: id é obrigatório`);
    else if (ids.has(item.id)) errors.push(`${label}: id repetido`);
    else ids.add(item.id);
    for (const side of ["from", "to"] as const) {
      const selector = item[side];
      if (!isRecord(selector)) {
        errors.push(`${label}: ${side} é um seletor (session, project, team, host)`);
        continue;
      }
      for (const [key, value] of Object.entries(selector)) {
        if (!(SELECTOR_KEYS as readonly string[]).includes(key)) {
          errors.push(`${label}: ${side}.${key} não existe`);
        } else if (typeof value !== "string" || value === "") {
          errors.push(`${label}: ${side}.${key} é um texto`);
        }
      }
    }
    if (item.bothWays !== undefined && typeof item.bothWays !== "boolean") {
      errors.push(`${label}: bothWays é verdadeiro ou falso`);
    }
    if (errors.length === before) exceptions.push(item as unknown as Exception);
  }
  if (errors.length > 0) return { policy: DEFAULT_POLICY, errors };
  return { policy: { ...DEFAULT_POLICY, ...numbers, exceptions }, errors };
}

const selects = (selector: Selector, party: Party): boolean =>
  (selector.session === undefined ||
    selector.session === party.id ||
    selector.session === addressOf(party)) &&
  (selector.project === undefined || selector.project === party.projectKey) &&
  (selector.team === undefined || selector.team === party.teamId) &&
  (selector.host === undefined || selector.host === party.host);

/** Whether the sender may message the target. */
export function access(from: Party, to: Party, policy: Policy): Access {
  if (addressOf(from) === addressOf(to)) {
    return { ok: false, reason: "uma sessão não manda mensagem para si mesma" };
  }
  if (from.projectKey !== null && from.projectKey === to.projectKey) {
    return { ok: true, via: "project" };
  }
  if (from.teamId !== null && from.teamId === to.teamId) return { ok: true, via: "team" };
  const allowed = policy.exceptions.some(
    (e) =>
      (selects(e.from, from) && selects(e.to, to)) ||
      (e.bothWays === true && selects(e.from, to) && selects(e.to, from)),
  );
  if (allowed) return { ok: true, via: "exception" };
  return {
    ok: false,
    reason:
      "as sessões não são do mesmo projeto nem do mesmo time, e nenhuma exceção em Configurações libera este par",
  };
}

/** Why the text is refused, or null. */
export function sizeError(text: string): string | null {
  if (text.trim() === "") return "mensagem vazia";
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return "mensagem acima de 32 KB";
  }
  return null;
}

/** The messages exchanged by a pair or sent by a session, as the history can count them. */
export interface History {
  /** Messages between the two sessions since an instant, by who sent them. */
  pair(a: string, b: string, sinceMs: number): { fromA: number; fromB: number };
  /** Messages a session sent since an instant. */
  sent(address: string, sinceMs: number): number;
}

export type Limit = { ok: true } | { ok: false; kind: "pair" | "session" | "loop"; reason: string };

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Whether one more message from `from` to `to` is within the limits. */
export function limits(
  from: string,
  to: string,
  history: History,
  now: number,
  policy: Policy,
): Limit {
  const recent = history.pair(from, to, now - policy.loopMinutes * MINUTE_MS);
  if (
    recent.fromA + recent.fromB + 1 > policy.loopMessages &&
    recent.fromA > 0 &&
    recent.fromB > 0
  ) {
    return {
      ok: false,
      kind: "loop",
      reason: `laço: mais de ${policy.loopMessages} mensagens em ${policy.loopMinutes} minutos indo e voltando entre o par; o par foi pausado`,
    };
  }
  const hour = history.pair(from, to, now - HOUR_MS);
  if (hour.fromA + hour.fromB >= policy.perPairPerHour) {
    return {
      ok: false,
      kind: "pair",
      reason: `limite de ${policy.perPairPerHour} por hora por par de sessões`,
    };
  }
  if (history.sent(from, now - HOUR_MS) >= policy.perSessionPerHour) {
    return {
      ok: false,
      kind: "session",
      reason: `limite de ${policy.perSessionPerHour} por hora por sessão`,
    };
  }
  return { ok: true };
}
