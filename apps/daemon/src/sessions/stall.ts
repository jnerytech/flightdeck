import type { SessionSummary } from "@flightdeck/protocol";
import type { ToolNote } from "./activity-clock.ts";

export interface StallTimers {
  setInterval(fn: () => unknown, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

/** What marks a session quiet: when it went silent and the last tool it called. */
export interface QuietInfo {
  since: string;
  tool: string | null;
}

export interface StallHost {
  list(): SessionSummary[];
  activity(sessionId: string): { lastEventAt: number | null; tool: ToolNote };
  markQuiet(sessionId: string, info: QuietInfo | null): void;
}

export interface StallOptions {
  host: StallHost;
  /** Minutes without an event before a running session is quiet; 0 is off. */
  minutes: number;
  now?: () => number;
  timers?: StallTimers;
}

/**
 * Marks a running session quiet once it has produced no event for N minutes (2N while a tool call
 * is open). While the setting is off there is no timer at all.
 */
export class StallWatcher {
  constructor(_opts: StallOptions) {}

  minutes(): number {
    return 0;
  }

  setMinutes(_minutes: number): void {}

  /** One look: the sessions that became quiet now, by id. */
  tick(): string[] {
    return [];
  }

  stop(): void {}
}
