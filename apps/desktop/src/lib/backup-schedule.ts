import type { Platform } from "../platform/types.ts";
import { type BackupOptions, type BackupPlatform, createBackup } from "./backup-bundle.ts";

/** Issue #1264: scheduled backups to a picked folder, keeping the last N files. */
export const SCHEDULE_KEY = "flightdeck.backupSchedule";
export const DEFAULT_KEEP = 5;

const DAY = 24 * 3_600_000;
const PERIOD: Record<Cadence, number> = {
  off: Number.POSITIVE_INFINITY,
  daily: DAY,
  weekly: 7 * DAY,
};

export type Cadence = "off" | "daily" | "weekly";

export interface BackupSchedule {
  cadence: Cadence;
  folder: string;
  keep: number;
  lastRunAt: number | null;
}

/** The folder of backups, as the Rust shell offers it: only files named like a backup. */
export type BackupFolder = NonNullable<Platform["backupFolder"]>;

export type SkipReason = "no-folder" | "no-passphrase" | "failed";

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

/** `flightdeck-backup-YYYYMMDD-HHMMSS.fdbackup`: the UTC time, so names sort by age. */
const NAME = /^flightdeck-backup-\d{8}-\d{6}\.fdbackup$/;

const OFF: BackupSchedule = { cadence: "off", folder: "", keep: DEFAULT_KEEP, lastRunAt: null };

/** The saved schedule; an unset or damaged one is off. */
export function loadSchedule(storage: BackupPlatform["storage"]): BackupSchedule {
  try {
    const raw = JSON.parse(
      storage.getItem(SCHEDULE_KEY) ?? "null",
    ) as Partial<BackupSchedule> | null;
    if (!raw || typeof raw !== "object") return { ...OFF };
    const cadence: Cadence =
      raw.cadence === "daily" || raw.cadence === "weekly" ? raw.cadence : "off";
    return {
      cadence,
      folder: typeof raw.folder === "string" ? raw.folder : "",
      keep:
        Number.isInteger(raw.keep) && (raw.keep as number) >= 1
          ? (raw.keep as number)
          : DEFAULT_KEEP,
      lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : null,
    };
  } catch {
    return { ...OFF };
  }
}

export function saveSchedule(storage: BackupPlatform["storage"], schedule: BackupSchedule): void {
  storage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
}

/** Whether a run is owed: a cadence is set, a folder is chosen, and a period passed since the last. */
export function isDue(schedule: BackupSchedule, now: number): boolean {
  if (schedule.cadence === "off" || schedule.folder === "") return false;
  return schedule.lastRunAt === null || now - schedule.lastRunAt >= PERIOD[schedule.cadence];
}

export function backupFileName(now: number): string {
  const iso = new Date(now).toISOString(); // 2026-11-08T12:00:00.000Z
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `flightdeck-backup-${day}-${time}.fdbackup`;
}

/**
 * Runs the schedule once: when it is due, writes a backup into the folder, then keeps the newest
 * `keep` files named like a backup and removes the rest. Nothing is removed unless the write worked,
 * and a skipped run says why instead of failing silently. The passphrase comes from memory.
 */
export async function runScheduledBackup(deps: {
  platform: BackupPlatform;
  folder: BackupFolder | undefined;
  schedule: BackupSchedule;
  passphrase: string | null;
  now: number;
  options?: BackupOptions;
}): Promise<RunReport> {
  const { platform, folder, schedule, passphrase, now } = deps;
  if (schedule.cadence === "off") return { status: "idle" };
  const at = now;
  if (schedule.folder === "" || !folder) return { status: "skipped", reason: "no-folder", at };
  if (!isDue(schedule, now)) return { status: "idle" };
  if (!passphrase) return { status: "skipped", reason: "no-passphrase", at };
  const keep = Math.max(1, Math.floor(schedule.keep));
  const name = backupFileName(now);
  try {
    const text = await createBackup(platform, passphrase, passphrase, deps.options);
    await folder.write(name, text);
    // Only names that look like a backup are ever considered, whatever the folder lists.
    const mine = (await folder.list())
      .filter((one) => NAME.test(one))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const stale = mine.slice(0, Math.max(0, mine.length - keep));
    for (const old of stale) await folder.remove(old);
    return {
      status: "done",
      name,
      kept: mine.length - stale.length,
      removed: stale.length,
      prune: "ok",
      at,
    };
  } catch {
    return { status: "skipped", reason: "failed", at };
  }
}
