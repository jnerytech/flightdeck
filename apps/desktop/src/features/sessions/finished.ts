import type { CommandResults, SessionStatus, SessionSummary } from "@flightdeck/protocol";
import { z } from "zod";
import { basename, readStored } from "@/shared/lib/index.ts";
import {
  FINISHED_CAP,
  type Finish,
  type FinishedState,
  finishOutcome,
  recordFinish,
  withFiles,
} from "./domain/finished-list.ts";
import { sessionKey } from "./domain/session-key.ts";

const FINISHED_KEY = "flightdeck.finished";

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
