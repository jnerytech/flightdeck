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

/** What the screen says about the next run: the reason it cannot run, or when it is due (#4000). */
export type NextBackup = { waitingFor: Exclude<SkipReason, "failed"> } | { at: number } | null;

/** What a run needs besides the schedule: whether a folder is stored, the passphrase is in memory and Drive is signed in. */
export interface RunReadiness {
  hasFolder: boolean;
  hasPassphrase: boolean;
  driveSignedIn: boolean;
}

/**
 * The next run, by the same rules `isDue` and the run use: null when the schedule is off, the first
 * reason a run would be skipped, or the time the next period ends (now, when a run is owed).
 */
export function nextBackup(schedule: BackupSchedule, ready: RunReadiness, now: number): NextBackup {
  if (schedule.cadence === "off") return null;
  const onDrive = schedule.target === "drive";
  // The order of `pickTarget` in run-schedule.ts: folder, then passphrase, then Drive sign-in.
  if (!onDrive && (schedule.folder === "" || !ready.hasFolder)) return { waitingFor: "no-folder" };
  if (!ready.hasPassphrase) return { waitingFor: "no-passphrase" };
  if (onDrive && !ready.driveSignedIn) return { waitingFor: "drive-auth" };
  if (schedule.lastRunAt === null || schedule.lastRunAt > now) return { at: now };
  return { at: Math.max(now, schedule.lastRunAt + PERIOD[schedule.cadence]) };
}

export function backupFileName(now: number): string {
  const iso = new Date(now).toISOString(); // 2026-11-08T12:00:00.000Z
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `flightdeck-backup-${day}-${time}.fdbackup`;
}
