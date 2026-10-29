import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BackupInfo, backupNow, keepLast, listBackups } from "./backup.ts";
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

export interface MaintenanceStatus {
  dbBytes: number;
  lastBackup: BackupInfo | null;
  backups: BackupInfo[];
  lastPrune: LastPrune | null;
  counts: { sessions: number; events: number; externalSessions: number };
}

export interface MaintenanceOptions {
  db: Database;
  dataDir: string;
  retention: RetentionPolicy;
  backup?: { enabled: boolean; keep: number };
  now?: () => number;
  timers?: MaintenanceTimers;
}

const DAY_MS = 86_400_000;
const DEFAULT_KEEP = 7;

/** Bookkeeping kept next to the database (not in it: no migration for a timestamp). */
const STATE_FILE = "maintenance.json";

interface State {
  lastPrune?: LastPrune;
}

/** Daily upkeep of a host's database: retention and backup at boot and every 24 h. */
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

  /** A backup now (into `out`, or the backups folder keeping the last `backup.keep`). */
  backupNow(out?: string): BackupInfo {
    const info = backupNow(this.opts.db, this.backupsDir, this.now(), out);
    if (!out) keepLast(this.backupsDir, this.opts.backup?.keep ?? DEFAULT_KEEP);
    return info;
  }

  status(): MaintenanceStatus {
    const db = this.opts.db;
    const count = (table: string) =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const { page_count } = db.query("PRAGMA page_count").get() as { page_count: number };
    const { page_size } = db.query("PRAGMA page_size").get() as { page_size: number };
    const backups = listBackups(this.backupsDir);
    return {
      dbBytes: page_count * page_size,
      lastBackup: backups[0] ?? null,
      backups,
      lastPrune: this.lastPrune(),
      counts: {
        sessions: count("sessions"),
        events: count("events"),
        externalSessions: count("external_sessions"),
      },
    };
  }

  lastPrune(): LastPrune | null {
    return this.state().lastPrune ?? null;
  }

  /** Retention, then a backup when enabled and the last one is a day old (or missing). */
  private daily(): void {
    this.prune(false);
    const last = listBackups(this.backupsDir)[0];
    const due = !last || this.now() - Date.parse(last.at) >= DAY_MS;
    if (this.opts.backup?.enabled && due) this.backupNow();
  }

  private get backupsDir(): string {
    return join(this.opts.dataDir, "backups");
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
