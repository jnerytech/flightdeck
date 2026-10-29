import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PruneCounts, prune, type RetentionPolicy } from "./retention.ts";

export interface MaintenanceTimers {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export interface LastPrune {
  at: string;
  dryRun: boolean;
  counts: PruneCounts;
}

export interface MaintenanceOptions {
  db: Database;
  dataDir: string;
  retention: RetentionPolicy;
  now?: () => number;
  timers?: MaintenanceTimers;
}

const DAY_MS = 86_400_000;

/** Bookkeeping kept next to the database (not in it: no migration for a timestamp). */
const STATE_FILE = "maintenance.json";

interface State {
  lastPrune?: LastPrune;
}

/** Daily upkeep of a host's database: retention at boot and every 24 h. */
export class Maintenance {
  private readonly now: () => number;
  private readonly timers: MaintenanceTimers;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: MaintenanceOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? globalThis;
  }

  start(): void {
    this.daily();
    this.timer = this.timers.setInterval(() => this.daily(), DAY_MS);
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** Applies the retention policy now (or only counts) and records it as the last cleanup. */
  prune(dryRun: boolean): PruneCounts {
    const at = this.now();
    const counts = prune(this.opts.db, this.opts.retention, { now: at, dryRun });
    this.save({ lastPrune: { at: new Date(at).toISOString(), dryRun, counts } });
    return counts;
  }

  lastPrune(): LastPrune | null {
    return this.state().lastPrune ?? null;
  }

  private daily(): void {
    this.prune(false);
  }

  private get file(): string {
    return join(this.opts.dataDir, STATE_FILE);
  }

  private state(): State {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as State) : {};
  }

  private save(patch: State): void {
    writeFileSync(this.file, JSON.stringify({ ...this.state(), ...patch }, null, 2));
  }
}
