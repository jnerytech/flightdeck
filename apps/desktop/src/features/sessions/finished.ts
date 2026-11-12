import type { CommandResults, SessionStatus, SessionSummary } from "@flightdeck/protocol";
import { z } from "zod";
import { basename, readStored } from "@/shared/lib/index.ts";
import { sessionKey } from "./session-key.ts";

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
  // A stored list is cut to the cap and its texts to a sane length: what is on disk is not trusted.
  list: z
    .array(
      z.object({
        key: z.string().max(400),
        hostId: z.string().max(200),
        sessionId: z.string().max(200),
        name: z.string().max(400),
        outcome: z.enum(["done", "failed", "ended"]),
        at: z.string().max(40),
        files: z.number().nullable(),
      }),
    )
    .transform((list) => list.slice(0, FINISHED_CAP)),
  lastLook: z.string().nullable(),
});

export function loadFinished(storage: { getItem(key: string): string | null }): FinishedState {
  return readStored(storage, FINISHED_KEY, Stored, { list: [], lastLook: null });
}

export function saveFinished(
  storage: { setItem(key: string, value: string): void },
  state: FinishedState,
): void {
  storage.setItem(FINISHED_KEY, JSON.stringify(state));
}

/** What the slice reads of a sidebar session: the store's `SidebarSession` fits it. */
interface FinishingSession {
  id: string;
  name: string | null;
  cwd: string;
  status: SessionStatus;
}

/** What the slice reads of the app's state: the store's `AppState` fits it. */
interface FinishedSliceState {
  finished: Finish[];
  finishedLook: string | null;
  sessions: Record<string, { claudeSessionId?: string }>;
  hub: Record<string, { managed: SessionSummary[] }>;
}

/** What the finished list reads and asks through the app's store. */
export interface FinishedCore {
  /** The finished list, the conversations and the hub's sessions the app holds. */
  state(): FinishedSliceState;
  update(patch: Partial<Pick<FinishedSliceState, "finished" | "finishedLook">>): void;
  /** Where the list is kept between runs. */
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Milliseconds now. */
  now(): number;
  /** Whether the app's window has the focus. */
  isFocused(): boolean;
  /** The sessions an area shows right now, by session key. */
  shown(): Set<string>;
  /** Asks a host what a session changed; a refusal comes back as not ok. */
  changes(
    hostId: string,
    target: string,
  ): Promise<{ ok: true; data: CommandResults["changes.get"] } | { ok: false }>;
}

/**
 * The sessions that finished, as Needs you lists them (#1596: a slice of the store): a finish
 * recorded on a status change, its file count asked of the host, the last look, all kept in the
 * storage.
 */
export class FinishedSlice {
  constructor(private readonly core: FinishedCore) {}

  /** The list and the last look kept from the previous run. */
  load(): void {
    const kept = loadFinished(this.core.storage);
    this.core.update({ finished: kept.list, finishedLook: kept.lastLook });
  }

  /** The person looked at Needs you: what finished before now is no longer new. */
  seen(): void {
    this.set(this.core.state().finished, new Date(this.core.now()).toISOString());
  }

  /** A turn, a failure or an end is a finish for Needs you, unless the person watched it happen. */
  record(hostId: string, prev: FinishingSession | undefined, next: FinishingSession): void {
    const outcome = finishOutcome(prev?.status, next.status);
    if (!outcome) return;
    const key = sessionKey(hostId, next.id);
    if (this.core.isFocused() && this.core.shown().has(key)) return;
    const at = new Date(this.core.now()).toISOString();
    const finish: Finish = {
      key,
      hostId,
      sessionId: next.id,
      name: next.name ?? basename(next.cwd),
      outcome,
      at,
      files: null,
    };
    const state = this.core.state();
    this.set(recordFinish(state.finished, finish), state.finishedLook);
    void this.countFiles(hostId, next.id, key, at);
  }

  private set(list: Finish[], lastLook: string | null): void {
    this.core.update({ finished: list, finishedLook: lastLook });
    saveFinished(this.core.storage, { list, lastLook });
  }

  /** Asks the host how many files the session changed; a host that cannot say leaves it unknown. */
  private async countFiles(
    hostId: string,
    sessionId: string,
    key: string,
    at: string,
  ): Promise<void> {
    // The host reads `session:<id>` as the Claude session id, which the app learns with the session.
    const state = this.core.state();
    const claudeId =
      state.sessions[key]?.claudeSessionId ??
      state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
    if (!claudeId) return;
    const result = await this.core.changes(hostId, `session:${claudeId}`);
    if (!result.ok) return;
    const files = result.data.files.length;
    const now = this.core.state();
    this.set(withFiles(now.finished, key, at, files), now.finishedLook);
  }
}
