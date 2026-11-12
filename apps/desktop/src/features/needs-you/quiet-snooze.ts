/**
 * The quiet sessions the person marked "Not stuck" (#1478, #1554): `host/session` → the time (ms)
 * the row may come back. Kept in the app's storage so a reload does not bring it back early.
 */
import type { Platform } from "../../platform/types.ts";

export const QUIET_SNOOZE_KEY = "flightdeck.quietSnooze";

type Storage = Platform["storage"];

/** The snoozes still running at `nowMs`; anything unreadable or past is left out. */
export function loadQuietSnooze(storage: Storage, nowMs: number): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(QUIET_SNOOZE_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const kept: Record<string, number> = {};
  for (const [key, until] of Object.entries(parsed)) {
    if (typeof until === "number" && Number.isFinite(until) && until > nowMs) kept[key] = until;
  }
  return kept;
}

export function saveQuietSnooze(storage: Storage, snoozes: Record<string, number>): void {
  try {
    storage.setItem(QUIET_SNOOZE_KEY, JSON.stringify(snoozes));
  } catch {
    // A full or blocked storage: the snooze still holds until the app closes.
  }
}
