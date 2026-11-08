import type { Platform } from "../platform/types.ts";
import {
  type BackupSchedule,
  type Cadence,
  DEFAULT_KEEP,
  loadSchedule,
  type RunReport,
  runScheduledBackup,
  saveSchedule,
} from "./backup-schedule.ts";

/** How often the app looks at whether a backup is owed. */
const CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * Issue #1264: the scheduled backups of this app run. It holds the passphrase in memory only: it is
 * asked once per app start, never saved, logged or put in a report. A run that is owed but cannot go
 * (no passphrase, no folder, a write that failed) is kept in `report` for the screen to show.
 */
export class BackupScheduler {
  version = 0;
  /** The folder the shell stores (what the backups really go to), or null when none is chosen. */
  folder: string | null = null;
  report: RunReport = { status: "idle" };
  private current: BackupSchedule;
  private passphrase: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly platform: Platform,
    private readonly options: { workFactor?: number; now?: () => number; intervalMs?: number } = {},
  ) {
    this.current = loadSchedule(platform.storage);
  }

  /** False on the web build, where no folder can be written. */
  get supported(): boolean {
    return this.platform.backupFolder !== undefined;
  }

  get hasPassphrase(): boolean {
    return this.passphrase !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  schedule(): BackupSchedule {
    return { ...this.current };
  }

  /** Reads the stored folder, runs what is owed, then looks again every few minutes. */
  async start(): Promise<void> {
    const folder = this.platform.backupFolder;
    if (!folder) return;
    this.folder = await folder.current().catch(() => null);
    if (this.folder && this.current.folder === "") this.current.folder = this.folder;
    this.notify();
    this.dispose();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? CHECK_INTERVAL_MS);
    await this.tick();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async setCadence(cadence: Cadence): Promise<void> {
    this.current.cadence = cadence;
    this.save();
    await this.tick();
  }

  async setKeep(keep: number): Promise<void> {
    this.current.keep = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : DEFAULT_KEEP;
    this.save();
  }

  /** Opens the folder dialog; a cancelled dialog changes nothing. */
  async chooseFolder(): Promise<void> {
    const picked = await this.platform.backupFolder?.pick();
    if (!picked) return;
    this.folder = picked;
    this.current.folder = picked;
    this.save();
    await this.tick();
  }

  /** Keeps the passphrase for this run of the app only, and runs what is owed with it. */
  async setPassphrase(passphrase: string): Promise<void> {
    this.passphrase = passphrase === "" ? null : passphrase;
    this.notify();
    await this.tick();
  }

  /** One look at the schedule: runs the backup when it is owed. The last run is saved only when it worked. */
  async tick(): Promise<void> {
    if (!this.supported || this.running) return;
    this.running = true;
    try {
      const report = await runScheduledBackup({
        platform: this.platform,
        folder: this.platform.backupFolder,
        schedule: this.current,
        passphrase: this.passphrase,
        now: (this.options.now ?? Date.now)(),
        options:
          this.options.workFactor === undefined ? {} : { workFactor: this.options.workFactor },
      });
      if (report.status === "done") {
        this.current.lastRunAt = report.at;
        this.save();
      }
      if (report.status !== "idle") this.report = report;
    } finally {
      this.running = false;
      this.notify();
    }
  }

  private save(): void {
    saveSchedule(this.platform.storage, this.current);
    this.notify();
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
