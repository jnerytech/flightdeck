/**
 * The quiet sessions the person marked "Not stuck" (#1478, #1554): `host/session` → the time (ms)
 * the row may come back. Kept in the app's storage so a reload does not bring it back early.
 */
import { z } from "zod";
import { readStored, validValues } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { Platform } from "../../platform/types.ts";

export const QUIET_SNOOZE_KEY = "flightdeck.quietSnooze";

type Storage = Platform["storage"];

const Snoozes = validValues(z.number());

/** The snoozes still running at `nowMs`; anything unreadable or past is left out. */
export function loadQuietSnooze(storage: Storage, nowMs: number): Record<string, number> {
  const kept = readStored(storage, QUIET_SNOOZE_KEY, Snoozes, {});
  return Object.fromEntries(Object.entries(kept).filter(([, until]) => until > nowMs));
}

export function saveQuietSnooze(storage: Storage, snoozes: Record<string, number>): void {
  try {
    storage.setItem(QUIET_SNOOZE_KEY, JSON.stringify(snoozes));
  } catch {
    // A full or blocked storage: the snooze still holds until the app closes.
  }
}

/** Issue #1478: how long "Not stuck" keeps a quiet session out of Needs you. */
export const QUIET_SNOOZE_MS = 60 * 60 * 1000;

/** What "Not stuck" reads and changes through the app's store (#1596). */
export interface QuietSnoozeCore {
  /** The snoozes in the app's state. */
  snoozes(): Record<string, number>;
  setSnoozes(snoozes: Record<string, number>): void;
  storage: Storage;
  now(): number;
  /** The sessions' key, host and session. */
  key(hostId: string, sessionId: string): string;
  t(): T;
  formatTime(iso: string): string;
  success(text: string): void;
}

/** "Not stuck" on a quiet session (#1478; #1596: a slice of the store). */
export class QuietSnoozeSlice {
  constructor(private readonly core: QuietSnoozeCore) {}

  /** Issue #1478: keeps a quiet session out of Needs you for an hour ("Not stuck"). */
  snooze(hostId: string, sessionId: string): void {
    const until = this.core.now() + QUIET_SNOOZE_MS;
    const quietSnooze = { ...this.core.snoozes(), [this.core.key(hostId, sessionId)]: until };
    this.core.setSnoozes(quietSnooze);
    saveQuietSnooze(this.core.storage, quietSnooze);
    // The row is gone from the list: say when it comes back (#1554).
    this.core.success(
      this.core.t()("needsYou.quietSnoozed", {
        time: this.core.formatTime(new Date(until).toISOString()),
      }),
    );
  }
}
