import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";
import type { BackupOptions, BackupPlatform } from "./backup-bundle.ts";
import { type BackupFolder, type BackupTarget, folderTarget, keepNewest } from "./backup-target.ts";
import { DriveError } from "./drive-target.ts";

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

/** Where the backups go: the picked folder or the app's folder on Google Drive (#1444). */
export type ScheduleTarget = "folder" | "drive";

export interface BackupSchedule {
  cadence: Cadence;
  target: ScheduleTarget;
  folder: string;
  keep: number;
  lastRunAt: number | null;
}

export type { BackupFolder };

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

const OFF: BackupSchedule = {
  cadence: "off",
  target: "folder",
  folder: "",
  keep: DEFAULT_KEEP,
  lastRunAt: null,
};

/** The schedule as kept: a field of the wrong type reads as its default, the others stay. */
const Saved = z.object({
  cadence: z.enum(["off", "daily", "weekly"]).catch("off"),
  target: z.enum(["folder", "drive"]).catch("folder"),
  folder: z.string().catch(""),
  keep: z.number().int().min(1).catch(DEFAULT_KEEP),
  lastRunAt: z.number().nullable().catch(null),
});

/** The saved schedule; an unset or damaged one is off. */
export function loadSchedule(storage: BackupPlatform["storage"]): BackupSchedule {
  return readStored(storage, SCHEDULE_KEY, Saved, { ...OFF });
}

export function saveSchedule(storage: BackupPlatform["storage"], schedule: BackupSchedule): void {
  // Only the four fields: whatever else the object carries is not written.
  const { cadence, target, folder, keep, lastRunAt } = schedule;
  storage.setItem(SCHEDULE_KEY, JSON.stringify({ cadence, target, folder, keep, lastRunAt }));
}

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

/** Where a due run writes: the Drive target or the stored folder, or the reason there is none. */
async function pickTarget(deps: {
  folder: BackupFolder | undefined;
  drive?: BackupTarget | null;
  schedule: BackupSchedule;
  passphrase: string | null;
}): Promise<{ target: BackupTarget; passphrase: string } | { reason: SkipReason }> {
  const { folder, schedule } = deps;
  const onDrive = schedule.target === "drive";
  // The folder in the saved schedule is only a copy; the one that counts is the stored pick.
  if (!onDrive && !(await folder?.current().catch(() => null))) return { reason: "no-folder" };
  const { passphrase } = deps;
  if (!passphrase) return { reason: "no-passphrase" };
  const target = onDrive ? deps.drive : folder && folderTarget(folder);
  return target ? { target, passphrase } : { reason: onDrive ? "drive-auth" : "no-folder" };
}

/** Writes one backup into the target; the reason it failed, or null when it is there. */
async function writeBackup(
  deps: { platform: BackupPlatform; options?: BackupOptions },
  target: BackupTarget,
  passphrase: string,
  name: string,
): Promise<SkipReason | null> {
  try {
    // Loaded when a backup runs, so the encryption library stays out of the start-up chunk.
    const { createBackup } = await import("./backup-bundle.ts");
    const text = await createBackup(deps.platform, passphrase, passphrase, deps.options);
    await target.put(name, text);
    return null;
  } catch (error) {
    // A sign-in Google no longer honours is the person's to fix; anything else is a failed write.
    return error instanceof DriveError && error.kind === "auth" ? "drive-auth" : "failed";
  }
}

/**
 * Runs the schedule once: when it is due, writes a backup into the folder, then keeps the newest
 * `keep` files named like a backup and removes the rest. Nothing is removed unless the write worked,
 * and a skipped run says why instead of failing silently. The passphrase comes from memory.
 */
export async function runScheduledBackup(deps: {
  platform: BackupPlatform;
  folder: BackupFolder | undefined;
  /** The Drive target, when the app can sign in; null or absent when it cannot. */
  drive?: BackupTarget | null;
  schedule: BackupSchedule;
  passphrase: string | null;
  now: number;
  options?: BackupOptions;
}): Promise<RunReport> {
  const { folder, schedule, now } = deps;
  if (schedule.cadence === "off") return { status: "idle" };
  const at = now;
  const onDrive = schedule.target === "drive";
  if (!onDrive && (schedule.folder === "" || !folder)) {
    return { status: "skipped", reason: "no-folder", at };
  }
  if (!isDue(schedule, now)) return { status: "idle" };
  const picked = await pickTarget(deps);
  if ("reason" in picked) return { status: "skipped", reason: picked.reason, at };
  const { target, passphrase: secret } = picked;
  const keep = Math.max(1, Math.floor(schedule.keep));
  const name = backupFileName(now);
  const failed = await writeBackup(deps, target, secret, name);
  if (failed) return { status: "skipped", reason: failed, at };
  // The backup exists now. Pruning keeps it and the newest others, whatever their dates say; if the
  // folder cannot be read or cleaned, the run still counts as done and says the prune failed.
  const pruned = await keepNewest(target, keep, name);
  return pruned.ok
    ? { status: "done", name, kept: pruned.kept, removed: pruned.removed, prune: "ok", at }
    : { status: "done", name, kept: 1, removed: pruned.removed, prune: "failed", at };
}
