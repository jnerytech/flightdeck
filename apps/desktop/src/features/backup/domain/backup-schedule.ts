/** Issue #1264: when a scheduled backup is due, what it is called, and the shapes of the schedule and of a run's report. */

export const DEFAULT_KEEP = 5;

const DAY = 24 * 3_600_000;
const PERIOD: Record<Cadence, number> = {
  off: Number.POSITIVE_INFINITY,
  daily: DAY,
  weekly: 7 * DAY,
};

export type Cadence = "off" | "daily" | "weekly";

/** Where the backups go: the picked folder or the app's folder on Google Drive (#1444). */
export type ScheduleTarget = "folder" | "drive";

export interface BackupSchedule {
  cadence: Cadence;
  target: ScheduleTarget;
  folder: string;
  keep: number;
  lastRunAt: number | null;
}

export type SkipReason = "no-folder" | "no-passphrase" | "failed" | "drive-auth";

export type RunReport =
  | {
      status: "done";
      name: string;
      kept: number;
      removed: number;
      prune: "ok" | "failed";
      at: number;
    }
  | { status: "skipped"; reason: SkipReason; at: number }
  | { status: "idle" };

/**
 * Whether a run is owed: a cadence is set, a folder is chosen (the Drive target needs none), and a
 * period passed since the last.
 */
export function isDue(schedule: BackupSchedule, now: number): boolean {
  if (schedule.cadence === "off") return false;
  if (schedule.target === "folder" && schedule.folder === "") return false;
  // A last run ahead of now (the clock moved back) cannot stand for a period that passed.
  return (
    schedule.lastRunAt === null ||
    schedule.lastRunAt > now ||
    now - schedule.lastRunAt >= PERIOD[schedule.cadence]
  );
}

export function backupFileName(now: number): string {
  const iso = new Date(now).toISOString(); // 2026-11-08T12:00:00.000Z
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `flightdeck-backup-${day}-${time}.fdbackup`;
}
