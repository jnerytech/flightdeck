import type { SessionStatus } from "@flightdeck/protocol";

/** How a session finished: its turn ended well, ended in an error, or the session itself ended. */
export type FinishOutcome = "done" | "failed" | "ended";

/** A session that finished, as Needs you lists it until the person has looked. */
export interface Finish {
  /** `hostId/sessionId`: one entry per session, the latest finish. */
  key: string;
  hostId: string;
  sessionId: string;
  name: string;
  outcome: FinishOutcome;
  /** When it finished (ISO). */
  at: string;
  /** How many files it changed; `null` while unknown. */
  files: number | null;
}

/** What the person last saw of the Finished list, kept between runs. */
export interface FinishedState {
  list: Finish[];
  /** When Needs you was last looked at (ISO); `null` before the first look. */
  lastLook: string | null;
}

/** How many finishes are kept. */
export const FINISHED_CAP = 50;

/** The finish a status change is, or `null` when it is not one. */
export function finishOutcome(
  _prev: SessionStatus | undefined,
  _next: SessionStatus,
): FinishOutcome | null {
  return null;
}

/** The list with `finish` in it: a session's earlier finish goes, the newest comes first. */
export function recordFinish(list: Finish[], _finish: Finish): Finish[] {
  return list;
}

/** The list with the file count of the finish `key` at `at` set; a later finish of it is left alone. */
export function withFiles(
  list: Finish[],
  _key: string,
  _at: string,
  _files: number | null,
): Finish[] {
  return list;
}

/** The finishes after the last look, newest first. */
export function sinceLastLook(_list: Finish[], _lastLook: string | null): Finish[] {
  return [];
}

export function loadFinished(_storage: { getItem(key: string): string | null }): FinishedState {
  return { list: [], lastLook: null };
}

export function saveFinished(
  _storage: { setItem(key: string, value: string): void },
  _state: FinishedState,
): void {}
