import type { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic-write.ts";
import { type BackupInfo, backupNow, keepLast, listBackups } from "./backup.ts";
import { type PruneCounts, prune, type RetentionPolicy } from "./retention.ts";

export interface MaintenanceTimers {
  setInterval(fn: () => unknown, ms: number): ReturnType<typeof setInterval>;
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
  /** Phase 12: the git snapshots go with the retention (50 per session, 30 days). */
  snapshots?: { prune(policy: { perSession: number; days: number }): Promise<number> };
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

  async start(): Promise<void> {
    await this.daily();
    this.timer = this.timers.setInterval(() => this.daily(), DAY_MS);
  }

  stop(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** Applies the retention policy now (or only counts) and records it as the last cleanup. */
  async prune(dryRun: boolean): Promise<PruneCounts> {
    const at = this.now();
    const counts = prune(this.opts.db, this.opts.retention, { now: at, dryRun });
    await this.save({ lastPrune: { at: new Date(at).toISOString(), dryRun, counts } });
    return counts;
  }

  /** A backup now (into `out`, or the backups folder keeping the last `backup.keep`). */
  async backupNow(out?: string): Promise<BackupInfo> {
    const info = await backupNow(this.opts.db, this.backupsDir, this.now(), out);
    if (!out) await keepLast(this.backupsDir, this.opts.backup?.keep ?? DEFAULT_KEEP);
    return info;
  }

  async status(): Promise<MaintenanceStatus> {
    const db = this.opts.db;
    const count = (table: string) =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const { page_count } = db.query("PRAGMA page_count").get() as { page_count: number };
    const { page_size } = db.query("PRAGMA page_size").get() as { page_size: number };
    const backups = await listBackups(this.backupsDir);
    return {
      dbBytes: page_count * page_size,
      lastBackup: backups[0] ?? null,
      backups,
      lastPrune: await this.lastPrune(),
      counts: {
        sessions: count("sessions"),
        events: count("events"),
        externalSessions: count("external_sessions"),
      },
    };
  }

  async lastPrune(): Promise<LastPrune | null> {
    return (await this.state()).lastPrune ?? null;
  }

  /** Retention, then a backup when enabled and the last one is a day old (or missing). */
  private async daily(): Promise<void> {
    await this.prune(false);
    void this.opts.snapshots?.prune({ perSession: 50, days: 30 });
    const last = (await listBackups(this.backupsDir))[0];
    const due = !last || this.now() - Date.parse(last.at) >= DAY_MS;
    if (this.opts.backup?.enabled && due) await this.backupNow();
  }

  private get backupsDir(): string {
    return join(this.opts.dataDir, "backups");
  }

  private get file(): string {
    return join(this.opts.dataDir, STATE_FILE);
  }

  private async state(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async save(patch: State): Promise<void> {
    await writeFileAtomic(
      this.file,
      JSON.stringify({ ...(await this.state()), ...patch }, null, 2),
    );
  }
}
