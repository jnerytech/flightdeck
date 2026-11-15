import {
  type BackupSchedule,
  backupFileName,
  isDue,
  type RunReport,
  type SkipReason,
} from "./backup-schedule.ts";
import { type BackupTarget, keepNewest } from "./backup-target.ts";

/**
 * What a run needs from the outside, so the rules below touch no folder, no Drive and no encryption:
 * the backup text, the target a picked folder makes, and whether a failure is a sign-in Google no
 * longer honours.
 */
export interface RunPorts<Platform, Options, Folder> {
  createBackup(
    platform: Platform,
    passphrase: string,
    options: Options | undefined,
  ): Promise<string>;
  folderTarget(folder: Folder): BackupTarget;
  isAuthError(error: unknown): boolean;
}

export interface RunDeps<Platform, Options, Folder> {
  platform: Platform;
  folder: Folder | undefined;
  /** The Drive target, when the app can sign in; null or absent when it cannot. */
  drive?: BackupTarget | null;
  schedule: BackupSchedule;
  passphrase: string | null;
  now: number;
  options?: Options;
}

/** Where a due run writes: the Drive target or the stored folder, or the reason there is none. */
async function pickTarget<Platform, Options, Folder extends { current(): Promise<unknown> }>(
  deps: RunDeps<Platform, Options, Folder>,
  ports: RunPorts<Platform, Options, Folder>,
): Promise<{ target: BackupTarget; passphrase: string } | { reason: SkipReason }> {
  const { folder, schedule } = deps;
  const onDrive = schedule.target === "drive";
  // The folder in the saved schedule is only a copy; the one that counts is the stored pick.
  if (!onDrive && !(await folder?.current().catch(() => null))) return { reason: "no-folder" };
  const { passphrase } = deps;
  if (!passphrase) return { reason: "no-passphrase" };
  const target = onDrive ? deps.drive : folder && ports.folderTarget(folder);
  return target ? { target, passphrase } : { reason: onDrive ? "drive-auth" : "no-folder" };
}

/** Writes one backup into the target; the reason it failed, or null when it is there. */
async function writeBackup<Platform, Options, Folder>(
  deps: RunDeps<Platform, Options, Folder>,
  ports: RunPorts<Platform, Options, Folder>,
  target: BackupTarget,
  passphrase: string,
  name: string,
): Promise<SkipReason | null> {
  try {
    const text = await ports.createBackup(deps.platform, passphrase, deps.options);
    await target.put(name, text);
    return null;
  } catch (error) {
    // A sign-in Google no longer honours is the person's to fix; anything else is a failed write.
    return ports.isAuthError(error) ? "drive-auth" : "failed";
  }
}

/**
 * Runs the schedule once: when it is due, writes a backup into the folder, then keeps the newest
 * `keep` files named like a backup and removes the rest. Nothing is removed unless the write worked,
 * and a skipped run says why instead of failing silently. The passphrase comes from memory.
 */
export async function runDueBackup<
  Platform,
  Options,
  Folder extends { current(): Promise<unknown> },
>(
  deps: RunDeps<Platform, Options, Folder>,
  ports: RunPorts<Platform, Options, Folder>,
): Promise<RunReport> {
  const { folder, schedule, now } = deps;
  if (schedule.cadence === "off") return { status: "idle" };
  const at = now;
  const onDrive = schedule.target === "drive";
  if (!onDrive && (schedule.folder === "" || !folder)) {
    return { status: "skipped", reason: "no-folder", at };
  }
  if (!isDue(schedule, now)) return { status: "idle" };
  const picked = await pickTarget(deps, ports);
  if ("reason" in picked) return { status: "skipped", reason: picked.reason, at };
  const { target, passphrase: secret } = picked;
  const keep = Math.max(1, Math.floor(schedule.keep));
  const name = backupFileName(now);
  const failed = await writeBackup(deps, ports, target, secret, name);
  if (failed) return { status: "skipped", reason: failed, at };
  // The backup exists now. Pruning keeps it and the newest others, whatever their dates say; if the
  // folder cannot be read or cleaned, the run still counts as done and says the prune failed.
  const pruned = await keepNewest(target, keep, name);
  return pruned.ok
    ? { status: "done", name, kept: pruned.kept, removed: pruned.removed, prune: "ok", at }
    : { status: "done", name, kept: 1, removed: pruned.removed, prune: "failed", at };
}
