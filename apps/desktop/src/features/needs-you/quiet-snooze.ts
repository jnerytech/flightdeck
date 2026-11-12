/**
 * The quiet sessions the person marked "Not stuck" (#1478, #1554): `host/session` → the time (ms)
 * the row may come back. Kept in the app's storage so a reload does not bring it back early.
 */
import { z } from "zod";
import { readStored, validValues } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";

export const QUIET_SNOOZE_KEY = "flightdeck.quietSnooze";

type Storage = Platform["storage"];

const Snoozes = validValues(z.number().finite());

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
