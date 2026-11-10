import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import type { Logger } from "../logger.ts";
import { TelemetryOptIn, type TelemetryOptInOptions } from "./optin.ts";
import { startTelemetry } from "./service.ts";
import { TelemetryStore } from "./store.ts";

/** What the host's telemetry is built from. */
export interface TelemetryDeps {
  db: Database;
  config: Config;
  configFile: string;
  /** Claude Code's user settings, where the opt-in writes the exporter's variables. */
  settingsPath: TelemetryOptInOptions["settingsPath"];
  log: Pick<Logger, "error">;
}

/**
 * Claude Code's OTLP events for the sessions of terminals (phase 23, issue #1593): the store, the
 * receiver that fills it and purges what is past the retention, and the opt-in the client turns.
 */
export async function createTelemetry({
  db,
  config,
  configFile,
  settingsPath,
  log,
}: TelemetryDeps) {
  const telemetryStore = new TelemetryStore(db);
  const telemetry = await startTelemetry({
    config,
    configFile,
    log,
    onEvents: (events) => {
      telemetryStore.add(events);
    },
    purge: () => {
      telemetryStore.prune(config.telemetry.retentionDays, Date.now());
    },
  });
  return {
    telemetryStore,
    telemetry,
    telemetryOptIn: new TelemetryOptIn({ configFile, settingsPath }),
  };
}
