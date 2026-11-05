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
  /** Minutes idle before a session sleeps; 0 is off. */
  minutes: number;
  now?: () => number;
  timers?: SleeperTimers;
}

/** How often the sleeper looks, while it is on. */
const CHECK_EVERY_MS = 30_000;

/**
 * Puts idle sessions to sleep once they have been idle for N minutes. While the setting is off
 * there is no timer at all; the manager decides who may sleep (see `SessionManager.sleep`).
 */
export class IdleSleeper {
  private readonly now: () => number;
  private readonly timers: SleeperTimers;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current = 0;

  constructor(private readonly opts: SleeperOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? globalThis;
    this.setMinutes(opts.minutes);
  }

  minutes(): number {
    return this.current;
  }

  /** Turns the sleeper on, off (0) or to another delay; the timer exists only while it is on. */
  setMinutes(minutes: number): void {
    this.current = minutes;
    this.stop();
    if (minutes > 0) this.timer = this.timers.setInterval(() => this.tick(), CHECK_EVERY_MS);
  }

  /** One look: the sessions idle for long enough that the manager lets sleep, by id. */
  async tick(): Promise<string[]> {
    if (this.current <= 0) return [];
    const limit = this.current * 60_000;
    const slept: string[] = [];
    for (const session of this.opts.manager.list()) {
      if (session.status !== "idle" || session.asleep) continue;
      if (this.now() - Date.parse(session.updatedAt) < limit) continue;
      if ((await this.opts.manager.sleep(session.id)) === "slept") slept.push(session.id);
    }
    return slept;
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }
}
