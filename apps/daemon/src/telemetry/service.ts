import type { Config } from "../config.ts";
import type { OtlpEvent } from "./otlp.ts";

export interface TelemetryOptions {
  config: Config;
  configFile: string;
  log: { error(message: string): void };
  onEvents: (events: OtlpEvent[]) => void;
}

export interface TelemetryService {
  /** The receiver's URL; `null` when telemetry is off or the port could not be taken. */
  url: string | null;
  stop(): Promise<void>;
}

export function startTelemetry(_opts: TelemetryOptions): TelemetryService {
  return { url: null, stop: async () => {} };
}
