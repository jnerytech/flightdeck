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
}

export const DEFAULT_POLICY: Policy = {
  exceptions: [],
  perPairPerHour: 20,
  perSessionPerHour: 100,
  loopMessages: 10,
  loopMinutes: 10,
};

/** A message above this many bytes is refused. */
export const MAX_TEXT_BYTES = 32 * 1024;

export type Access =
  | { ok: true; via: "project" | "team" | "exception" }
  | { ok: false; reason: string };

/** The policy that is valid, or why it is not. */
export function validatePolicy(_raw: unknown): { policy: Policy; errors: string[] } {
  return { policy: DEFAULT_POLICY, errors: [] };
}

/** Whether the sender may message the target. */
export function access(_from: Party, _to: Party, _policy: Policy): Access {
  return { ok: false, reason: "" };
}

/** Why the text is refused, or null. */
export function sizeError(_text: string): string | null {
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

/** Whether one more message from `from` to `to` is within the limits. */
export function limits(
  _from: string,
  _to: string,
  _history: History,
  _now: number,
  _policy: Policy,
): Limit {
  return { ok: true };
}
