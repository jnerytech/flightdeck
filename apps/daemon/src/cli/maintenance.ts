/**
 * The maintenance commands of the command line (issue #1593): `flightdeckd backup`, `restore` and
 * `db prune`, over the maintenance domain and the store.
 */
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { Maintenance, restoreBackup } from "../maintenance/index.ts";
import { EventStore } from "../store/index.ts";
import { type CliArgs, configPath } from "./args.ts";

/** What the maintenance commands need of the command line's deps (main.ts's `CliDeps`). */
export interface MaintenanceCommandDeps {
  log: { log(message: string): void; error(message: string): void };
  /** Clock of `db prune`, `backup` and `restore`; `Date.now` when absent. */
  now?: () => number;
}

/** `flightdeckd backup [--out <file>]`: a backup now, with the daemon running or not. */
export async function runBackup(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const info = await new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      backup: config.backup,
      ...(deps.now ? { now: deps.now } : {}),
    }).backupNow(args.out);
    deps.log.log(`backup created: ${info.path} (${info.bytes} bytes)`);
  } finally {
    store.close();
  }
}

/** `flightdeckd restore <file>`: only with the daemon stopped. */
export async function runRestore(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  if (!args.file) throw new Error("restore needs the file: flightdeckd restore <file>");
  const config = await loadConfig(configPath(args));
  const { beforeRestore } = await restoreBackup({ file: args.file, dataDir: config.dataDir });
  deps.log.log(`database restored from ${args.file}; the previous one stayed at ${beforeRestore}`);
}

/** `flightdeckd db prune [--dry-run]`: the retention policy now, with the count per table. */
export async function runPrune(args: CliArgs, deps: MaintenanceCommandDeps): Promise<void> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const maintenance = new Maintenance({
      db: store.db,
      dataDir: config.dataDir,
      retention: config.retention,
      ...(deps.now ? { now: deps.now } : {}),
    });
    const counts = await maintenance.prune(args.dryRun === true);
    deps.log.log(args.dryRun ? "dry run of the cleanup (nothing was deleted):" : "cleanup done:");
    for (const [table, n] of Object.entries(counts)) deps.log.log(`  ${table}: ${n}`);
  } finally {
    store.close();
  }
}
