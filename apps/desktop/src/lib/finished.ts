import type { SessionStatus } from "@flightdeck/protocol";
import { z } from "zod";

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

const FINISHED_KEY = "flightdeck.finished";

/** The states of a turn in progress: leaving them is the end of a turn, as the notifications read it. */
const IN_TURN: ReadonlySet<SessionStatus> = new Set(["starting", "running", "awaiting_permission"]);

/** The finish a status change is, or `null` when it is not one. */
export function finishOutcome(
  prev: SessionStatus | undefined,
  next: SessionStatus,
): FinishOutcome | null {
  if (!prev) return null;
  if (next === "ended") return prev === "ended" ? null : "ended";
  if (!IN_TURN.has(prev)) return null;
  if (next === "idle") return "done";
  if (next === "error") return "failed";
  return null;
}

/** The list with `finish` in it: a session's earlier finish goes, the newest comes first. */
export function recordFinish(list: Finish[], finish: Finish): Finish[] {
  return [finish, ...list.filter((f) => f.key !== finish.key)]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, FINISHED_CAP);
}

/** The list with the file count of the finish `key` at `at` set; a later finish of it is left alone. */
export function withFiles(list: Finish[], key: string, at: string, files: number | null): Finish[] {
  return list.map((f) => (f.key === key && f.at === at ? { ...f, files } : f));
}

/** The finishes after the last look, newest first. */
export function sinceLastLook(list: Finish[], lastLook: string | null): Finish[] {
  const seen = lastLook === null ? Number.NEGATIVE_INFINITY : Date.parse(lastLook);
  return list
    .filter((f) => Date.parse(f.at) > seen)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const Stored = z.object({
  list: z.array(
    z.object({
      key: z.string(),
      hostId: z.string(),
      sessionId: z.string(),
      name: z.string(),
      outcome: z.enum(["done", "failed", "ended"]),
      at: z.string(),
      files: z.number().nullable(),
    }),
  ),
  lastLook: z.string().nullable(),
});

export function loadFinished(storage: { getItem(key: string): string | null }): FinishedState {
  try {
    return Stored.parse(JSON.parse(storage.getItem(FINISHED_KEY) ?? "null"));
  } catch {
    return { list: [], lastLook: null };
  }
}

export function saveFinished(
  storage: { setItem(key: string, value: string): void },
  state: FinishedState,
): void {
  storage.setItem(FINISHED_KEY, JSON.stringify(state));
}
