import type { SessionSummary } from "@flightdeck/protocol";

export interface SleeperTimers {
  setInterval(fn: () => unknown, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export interface SleeperOptions {
  manager: {
    list(): SessionSummary[];
    sleep(sessionId: string): Promise<string>;
  };
  minutes: number;
  now?: () => number;
  timers?: SleeperTimers;
}

/** Puts idle sessions to sleep after N minutes (stub: does nothing). */
export class IdleSleeper {
  constructor(_opts: SleeperOptions) {}
  minutes(): number {
    return 0;
  }
  setMinutes(_minutes: number): void {}
  async tick(): Promise<string[]> {
    return [];
  }
  stop(): void {}
}
