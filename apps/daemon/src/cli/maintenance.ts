/**
 * The maintenance commands of the command line (issue #1593): `flightdeckd backup`, `restore` and
 * `db prune`, over the maintenance domain and the store.
 */

import { join } from "node:path";
import { loadConfig } from "../config.ts";
import type { Logger } from "../kernel/index.ts";
import { Maintenance, restoreBackup, statusLines, TargetExists } from "../maintenance/index.ts";
import { EventStore } from "../store/index.ts";
import { configPath } from "./config-path.ts";
import type { CliArgs } from "./domain/args.ts";

/** What the maintenance commands need of the command line's deps (main.ts's `CliDeps`). */
export interface MaintenanceCommandDeps {
  log: Logger;
  /** Clock of `db prune`, `backup` and `restore`; `Date.now` when absent. */
  now?: () => number;
}

/** Runs `work` over the host's database and its maintenance, with the daemon running or not, and closes the store. */
async function withMaintenance<T>(
  args: CliArgs,
  deps: MaintenanceCommandDeps,
  work: (maintenance: Maintenance) => Promise<T>,
): Promise<T> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    return await work(
      new Maintenance({
        db: store.db,
        dataDir: config.dataDir,
        retention: config.retention,
        backup: config.backup,
        ...(deps.now ? { now: deps.now } : {}),
      }),
    );
  } finally {
    store.close();
  }
}

/**
 * `flightdeckd backup [--out <file>] [--force] [--json]`: a backup now, with the daemon running or not. A path that
 * is taken is a refusal (exit 1, reason `target_exists`), and `--force` replaces a file there (#3809).
 */
export async function runBackup(args: CliArgs, deps: MaintenanceCommandDeps): Promise<number> {
  try {
    const info = await withMaintenance(args, deps, (m) => m.backupNow(args.out, args.force));
    deps.log.log(
      args.json
        ? JSON.stringify(info, null, 2)
        : `backup created: ${info.path} (${info.bytes} bytes)`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof TargetExists)) throw error;
    // The refusal a script reads as one JSON line with its stable reason, as `reported` prints a remote one (#3429).
    deps.log.error(
      args.json
        ? JSON.stringify({ error: error.message, reason: error.code })
        : `flightdeckd: ${error.message}`,
    );
    return 1;
  }
}

/** `flightdeckd restore <file>`: only with the daemon stopped. */
export async function runRestore(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  if (!args.file) throw new Error("restore needs the file: flightdeckd restore <file>");
  const config = await loadConfig(configPath(args));
  const { beforeRestore } = await restoreBackup({ file: args.file, dataDir: config.dataDir });
  deps.log.log(`database restored from ${args.file}; the previous one stayed at ${beforeRestore}`);
}

/** `flightdeckd db status|prune`: the two verbs of the database commands. */
export async function runDb(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  if (args.action === "status") return await runDbStatus(args, deps);
  // A prune deletes: it runs only when it is asked for by name, never as the default of a missing action.
  if (args.action === "prune") return await runPrune(args, deps);
  throw new Error("invalid db action");
}

/** `flightdeckd db prune [--dry-run] [--json]`: the retention policy now, with the count per table. */
async function runPrune(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  const dryRun = args.dryRun === true;
  const counts = await withMaintenance(args, deps, (m) => m.prune(dryRun));
  if (args.json) {
    deps.log.log(JSON.stringify({ dryRun, counts }, null, 2));
    return;
  }
  deps.log.log(dryRun ? "dry run of the cleanup (nothing was deleted):" : "cleanup done:");
  for (const [table, n] of Object.entries(counts)) deps.log.log(`  ${table}: ${n}`);
}

/** `flightdeckd db status [--json]`: the size, the backups and the last cleanup, read from the files, with no daemon. */
async function runDbStatus(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  const status = await withMaintenance(args, deps, (m) => m.status());
  if (args.json) deps.log.log(JSON.stringify(status, null, 2));
  else for (const line of statusLines(status)) deps.log.log(line);
}
