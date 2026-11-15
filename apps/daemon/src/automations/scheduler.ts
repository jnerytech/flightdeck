import type { Database } from "bun:sqlite";
import type { Automation, AutomationRun } from "@flightdeck/protocol";
import type { CronSpec } from "./domain/cron.ts";
import { MINUTE, minuteOf, planSlots, scanFrom } from "./domain/cron-slots.ts";
import type { AutomationEvent } from "./domain/event.ts";

/** What the scheduler asks of the automations it wakes. */
export interface SchedulerDeps {
  db: Database;
  /** Milliseconds now. */
  clock: () => number;
  /** The tick's interval (a minute when absent). */
  tickMs?: number;
  /** The issue search's interval (5 minutes when absent). */
  pollMs?: number;
  /** The automations that are on. */
  enabled: () => Automation[];
  /** The parsed cron of a cron automation. */
  spec: (auto: Automation) => CronSpec;
  /** Runs the automations an event matches; read at each call, so a replaced method is the one used. */
  fire: (event: AutomationEvent) => Promise<void>;
  record: (
    auto: Automation,
    at: number,
    cause: string,
    status: AutomationRun["status"],
    detail: string | null,
  ) => void;
  /** One search of the issues for `issue_label` automations. */
  search: () => Promise<void>;
}

/**
 * When the automations fire: the minute tick for a cron one, the issue search for an
 * `issue_label` one, and the catch-up of the minutes the daemon was stopped for. Each timer runs
 * only while an automation needs it.
 */
export class Scheduler {
  /** The minute tick, while a cron automation is on; the issue search, while an issue one is. */
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** The search and the tick in progress, so `idle` can wait for them. */
  private searching: Promise<void> | null = null;
  private ticking: Promise<void> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * Slots that came up while the daemon was stopped are only recorded as missed, never run; then
   * the timers start.
   */
  start(): void {
    void this.advance(this.deps.clock(), false);
    this.started = true;
    this.arm(false);
  }

  stop(): void {
    this.started = false;
    this.arm();
  }

  /** Fires the cron automations whose minute has come; slots that went by unseen are missed. */
  async tick(now: number): Promise<void> {
    // A tick that finds another one running leaves its minutes to the next: they are scanned
    // from the last minute seen.
    if (this.ticking) return;
    this.ticking = this.advance(now, true).finally(() => {
      this.ticking = null;
    });
    await this.ticking;
  }

  /** The search of issues for `issue_label` automations, one list per project. */
  async pollIssues(): Promise<void> {
    // One search at a time: a slow CLI must not pile searches up under a short interval.
    if (this.searching) return;
    this.searching = this.deps.search().finally(() => {
      this.searching = null;
    });
    await this.searching;
  }

  /**
   * Each timer runs only while an automation needs it: the minute tick for a cron one, the issue
   * search for an `issue_label` one. A tick that starts later (the first cron automation was just
   * turned on) starts from this minute: the time before it was nobody's slot to miss.
   */
  arm(afterStart = true): void {
    const on = this.started ? this.deps.enabled() : [];
    const wantTick = on.some((auto) => auto.trigger.type === "cron");
    const wantPoll = on.some((auto) => auto.trigger.type === "issue_label");
    if (wantTick && this.tickTimer === null) {
      if (afterStart) this.markClock(this.deps.clock());
      this.tickTimer = setInterval(
        () => void this.tick(this.deps.clock()),
        this.deps.tickMs ?? MINUTE,
      );
    } else if (!wantTick && this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (wantPoll && this.pollTimer === null) {
      this.pollTimer = setInterval(() => void this.pollIssues(), this.deps.pollMs ?? 5 * MINUTE);
    } else if (!wantPoll && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Resolves when the tick and the search in progress, if any, are done. */
  async idle(): Promise<void> {
    await Promise.all([this.ticking, this.searching]);
  }

  private markClock(now: number): void {
    this.deps.db
      .query(
        "INSERT INTO automation_clock (id, last_tick) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET last_tick = excluded.last_tick",
      )
      .run(minuteOf(now));
  }

  /** The minutes since the last one seen, up to `now`: recent ones fire (when `fire`), old ones are missed. */
  private async advance(now: number, fire: boolean): Promise<void> {
    const { db, enabled, spec, record } = this.deps;
    const minute = minuteOf(now);
    const last = db
      .query<{ last_tick: number }, []>("SELECT last_tick FROM automation_clock WHERE id = 1")
      .get()?.last_tick;
    this.markClock(now);
    const from = scanFrom(last, minute);
    const crons = enabled().filter((auto) => auto.trigger.type === "cron");
    for (const auto of crons) {
      const zone = (auto.trigger as { tz: string }).tz;
      const { due, missed } = planSlots(spec(auto), zone, from, minute, fire, last !== undefined);
      for (const slot of due) {
        const event = {
          type: "cron",
          projectId: auto.projectId,
          automationId: auto.id,
          minute: slot,
        } as const;
        await this.deps.fire(event); // NOSONAR: a boot (fire=false) never gets here and must finish without yielding
      }
      for (const slot of missed) {
        record(
          auto,
          slot,
          `missed schedule of ${new Date(slot).toISOString()}`,
          "missed",
          "the daemon was stopped",
        );
      }
    }
  }
}
