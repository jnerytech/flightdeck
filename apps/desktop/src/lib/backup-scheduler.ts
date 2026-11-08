import type { Platform } from "../platform/types.ts";
import {
  type BackupSchedule,
  type Cadence,
  DEFAULT_KEEP,
  loadSchedule,
  type RunReport,
} from "./backup-schedule.ts";

/** Issue #1264: the scheduled backups of this app run. Holds the passphrase in memory only. */
export class BackupScheduler {
  version = 0;
  supported = true;
  folder: string | null = null;
  report: RunReport = { status: "idle" };
  hasPassphrase = false;
  private current: BackupSchedule;

  constructor(
    private readonly platform: Platform,
    private readonly options: { workFactor?: number; now?: () => number; intervalMs?: number } = {},
  ) {
    this.current = loadSchedule(platform.storage);
  }

  subscribe =
    (_listener: () => void): (() => void) =>
    () => {};

  schedule(): BackupSchedule {
    return { cadence: "off", folder: "", keep: DEFAULT_KEEP, lastRunAt: null };
  }

  async start(): Promise<void> {}
  dispose(): void {}
  async setCadence(_cadence: Cadence): Promise<void> {}
  async setKeep(_keep: number): Promise<void> {}
  async chooseFolder(): Promise<void> {}
  async setPassphrase(_passphrase: string): Promise<void> {}
  async tick(): Promise<void> {}
}
