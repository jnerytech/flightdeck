import type { T } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";
import { type HubRowState, hubRows } from "./hub.ts";

/** How long "Not stuck" keeps a quiet session out of Needs you. */
export const QUIET_SNOOZE_MS = 60 * 60 * 1000;

/** The parts of the state the quiet sessions are made of. */
export type QuietState = HubRowState & Pick<AppState, "quietSnooze">;

/** A running session the host marked quiet, as Needs you lists it. */
export interface QuietAlert {
  /** `host/session`. */
  key: string;
  hostId: string;
  hostName: string;
  sessionId: string;
  title: string;
  /** When it went silent (ISO). */
  since: string;
  tool: string | null;
}

export function quietAlerts(_state: QuietState, _nowMs: number): QuietAlert[] {
  void hubRows;
  return [];
}

/** "Quiet for 23 min · last: Bash". */
export function quietText(_alert: QuietAlert, _nowMs: number, _t: T): string {
  return "";
}
