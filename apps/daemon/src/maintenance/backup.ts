import { Database } from "bun:sqlite";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { acquireLock } from "../lock.ts";
import { MIGRATIONS } from "../store/migrations.ts";

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

/**
 * `VACUUM INTO` a consistent copy, safe with the daemon running (WAL). Owner-only file (0600
 * outside Windows). `out` replaces the automatic name in `dir`.
 */
export function backupNow(db: Database, dir: string, now: number, out?: string): BackupInfo {
  const path = out ?? join(dir, backupName(now));
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  db.query("VACUUM INTO ?").run(path);
  chmodSync(path, 0o600);
  return { path, at: new Date(now).toISOString(), bytes: statSync(path).size };
}

/** The automatic backups in `dir`, newest first. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const m = NAME.exec(name);
      if (!m) return [];
      const path = join(dir, name);
      const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
      return [{ path, at, bytes: statSync(path).size }];
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Deletes all but the newest `keep` automatic backups; returns what went. */
export function keepLast(dir: string, keep: number): string[] {
  const old = listBackups(dir).slice(keep);
  for (const backup of old) rmSync(backup.path, { force: true });
  return old.map((backup) => backup.path);
}

/** Refuses anything that is not an intact database this flightdeckd knows how to migrate. */
function checkBackup(file: string): void {
  let integrity = "ilegível";
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
    // Not a SQLite database: integrity stays "ilegível".
  }
  if (integrity !== "ok") {
    throw new Error(`o backup não passou na verificação de integridade (${integrity})`);
  }
  if (version > MIGRATIONS.length) {
    throw new Error(
      `o backup veio de uma versão mais nova do flightdeckd (user_version ${version}; esta conhece ${MIGRATIONS.length})`,
    );
  }
}

/**
 * `flightdeckd restore <file>`: only with the daemon stopped (its lock free). The current
 * database is kept as `flightdeck.db.before-restore`; missing migrations run on the next boot.
 */
export function restoreBackup(opts: { file: string; dataDir: string }): { beforeRestore: string } {
  const lock = acquireLock(opts.dataDir);
  if (!lock) {
    throw new Error("o daemon está rodando com este dataDir: pare o daemon e rode de novo");
  }
  try {
    checkBackup(opts.file);
    const current = join(opts.dataDir, "flightdeck.db");
    const beforeRestore = `${current}.before-restore`;
    if (existsSync(current)) {
      // Fold the WAL into the file first, so the copy is the whole database.
      const db = new Database(current);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      copyFileSync(current, beforeRestore);
    }
    copyFileSync(opts.file, current);
    for (const suffix of ["-wal", "-shm"]) rmSync(`${current}${suffix}`, { force: true });
    return { beforeRestore };
  } finally {
    lock.release();
  }
}
