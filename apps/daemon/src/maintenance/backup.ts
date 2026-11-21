import { Database } from "bun:sqlite";
import { chmod, copyFile, lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { withLock } from "../kernel/index.ts";
import { MIGRATIONS } from "../store/index.ts";

export interface BackupInfo {
  path: string;
  at: string;
  bytes: number;
}

const NAME = /^flightdeck-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** `flightdeck-<AAAAMMDD-HHmmss>.db`, in UTC so names sort in time order on every host. */
function backupName(now: number): string {
  const d = new Date(now);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `flightdeck-${day}-${time}.db`;
}

/** `backup --out` found something at the path it was asked to write (#3809). */
export class TargetExists extends Error {
  readonly code = "target_exists";
  constructor(path: string, isDirectory: boolean) {
    super(
      isDirectory
        ? `${path} is a folder, and a backup does not replace a folder: name a file`
        : `${path} already exists: pass --force to replace it`,
    );
    this.name = "TargetExists";
  }
}

/**
 * `VACUUM INTO` a consistent copy, safe with the daemon running (WAL). Owner-only file (0600
 * outside Windows). `out` replaces the automatic name in `dir`, and refuses whatever it finds there
 * (`lstat`, so a link counts as itself, a dangling one too) unless `force` says to replace a file or
 * the link itself, never a folder and never what a link points to (#3809). The automatic name is not
 * guarded: it is the daemon's own file.
 */
export async function backupNow(
  db: Database,
  dir: string,
  now: number,
  out?: string,
  force?: boolean,
): Promise<BackupInfo> {
  const path = out ?? join(dir, backupName(now));
  await mkdir(dirname(path), { recursive: true });
  if (out !== undefined) {
    const found = await lstat(out).catch(() => null);
    if (found && (!force || found.isDirectory())) throw new TargetExists(out, found.isDirectory());
  }
  await rm(path, { force: true });
  db.query("VACUUM INTO ?").run(path);
  await chmod(path, 0o600);
  return { path, at: new Date(now).toISOString(), bytes: (await stat(path)).size };
}

/** The automatic backups in `dir`, newest first. */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const found = await Promise.all(
    names.map(async (name) => {
      const m = NAME.exec(name);
      if (!m) return [];
      const path = join(dir, name);
      const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
      return [{ path, at, bytes: (await stat(path)).size }];
    }),
  );
  return found.flat().sort((a, b) => b.at.localeCompare(a.at));
}

/** Deletes all but the newest `keep` automatic backups; returns what went. */
export async function keepLast(dir: string, keep: number): Promise<string[]> {
  const old = (await listBackups(dir)).slice(keep);
  await Promise.all(old.map((backup) => rm(backup.path, { force: true })));
  return old.map((backup) => backup.path);
}

/** Refuses anything that is not an intact database this flightdeckd knows how to migrate. */
function checkBackup(file: string): void {
  let integrity = "unreadable";
  let version = 0;
  try {
    const db = new Database(file, { readonly: true });
    try {
      integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
        .integrity_check;
      version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    } finally {
      db.close();
    }
  } catch {
    // Not a SQLite database: integrity stays "unreadable".
  }
  if (integrity !== "ok") {
    throw new Error(`the backup failed the integrity check (${integrity})`);
  }
  if (version > MIGRATIONS.length) {
    throw new Error(
      `the backup comes from a newer flightdeckd (user_version ${version}; this one knows ${MIGRATIONS.length})`,
    );
  }
}

/**
 * `flightdeckd restore <file>`: only with the daemon stopped (its lock free). The current
 * database is kept as `flightdeck.db.before-restore`; missing migrations run on the next boot.
 */
export async function restoreBackup(opts: {
  file: string;
  dataDir: string;
}): Promise<{ beforeRestore: string }> {
  return withLock(opts.dataDir, "stop the daemon and run again", async () => {
    checkBackup(opts.file);
    const current = join(opts.dataDir, "flightdeck.db");
    const beforeRestore = `${current}.before-restore`;
    if (
      await stat(current).then(
        () => true,
        () => false,
      )
    ) {
      // Fold the WAL into the file first, so the copy is the whole database.
      const db = new Database(current);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      await copyFile(current, beforeRestore);
    }
    await copyFile(opts.file, current);
    await inSequence(["-wal", "-shm"], async (suffix) => {
      await rm(`${current}${suffix}`, { force: true });
    });
    return { beforeRestore };
  });
}
