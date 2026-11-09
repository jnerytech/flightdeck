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
  /** What one "minute" lasts, in milliseconds; the demo and the journeys shorten it. */
  unitMs?: number;
}

/** How often the watcher looks, while it is on. */
const CHECK_EVERY_MS = 30_000;

/**
 * Marks a running session quiet once it has produced no event for N minutes (2N while a tool call
 * is open). While the setting is off there is no timer at all.
 */
export class StallWatcher {
  private readonly now: () => number;
  private readonly timers: StallTimers;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current = 0;
  /** The sessions marked quiet and not yet cleared. */
  private readonly marked = new Set<string>();

  constructor(private readonly opts: StallOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? globalThis;
    this.setMinutes(opts.minutes);
  }

  minutes(): number {
    return this.current;
  }

  /** Turns the watcher on, off (0) or to another delay; the timer exists only while it is on. */
  setMinutes(minutes: number): void {
    this.current = minutes;
    this.stop();
    if (minutes > 0) this.timer = this.timers.setInterval(() => this.tick(), CHECK_EVERY_MS);
    else this.clearAll();
  }

  /** One look: the sessions that became quiet now, by id. */
  tick(): string[] {
    if (this.current <= 0) return [];
    const became: string[] = [];
    const seen = new Set<string>();
    for (const session of this.opts.host.list()) {
      seen.add(session.id);
      const quiet = this.quietOf(session);
      if (quiet && !this.marked.has(session.id)) {
        this.marked.add(session.id);
        this.opts.host.markQuiet(session.id, quiet);
        became.push(session.id);
      } else if (!quiet && this.marked.has(session.id)) {
        this.marked.delete(session.id);
        this.opts.host.markQuiet(session.id, null);
      }
    }
    // A session that left the list takes its mark with it.
    for (const id of this.marked) if (!seen.has(id)) this.marked.delete(id);
    return became;
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  private quietOf(session: SessionSummary): QuietInfo | null {
    if (session.status !== "running") return null;
    const { lastEventAt, tool } = this.opts.host.activity(session.id);
    if (lastEventAt === null) return null;
    const limit = this.current * 60_000 * (tool.inFlight ? 2 : 1);
    if (this.now() - lastEventAt < limit) return null;
    return { since: new Date(lastEventAt).toISOString(), tool: tool.name };
  }

  private clearAll(): void {
    for (const id of this.marked) this.opts.host.markQuiet(id, null);
    this.marked.clear();
  }
}
