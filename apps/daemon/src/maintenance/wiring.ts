import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { Maintenance, type MaintenanceOptions } from "./maintenance.ts";

/** What the daemon's upkeep is built from. */
export interface MaintenanceDeps {
  db: Database;
  config: Pick<Config, "dataDir" | "retention" | "backup">;
  snapshots: MaintenanceOptions["snapshots"];
}

/**
 * The daemon's upkeep (phase 7, issue #2094): retention at boot and every 24 h, backups joining it
 * in the same daily pass. Its start awaits the boot's pass.
 */
export function createMaintenance({ db, config, snapshots }: MaintenanceDeps) {
  const maintenance = new Maintenance({
    db,
    dataDir: config.dataDir,
    retention: config.retention,
    backup: config.backup,
    snapshots,
  });
  const module: DomainModule<"maintenance"> = {
    server: { maintenance },
    start: () => maintenance.start(),
    stop: () => maintenance.stop(),
  };
  return { modules: [module] as const };
}
