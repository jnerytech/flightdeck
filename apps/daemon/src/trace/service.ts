import type { Database } from "bun:sqlite";
import type { SecretScanner, SessionTrace, TraceExport } from "@flightdeck/protocol";
import type { TelemetryStore } from "../telemetry/store.ts";

export interface TraceServiceOptions {
  db: Database;
  /** Looks for secrets in the content an export carries. */
  scanner: SecretScanner;
  /** The real time of tool calls, when the host receives telemetry (phase 23). */
  telemetry?: TelemetryStore;
}

/** Builds the trace of a session from its transcript on disk, the prices already computed and the telemetry. */
export class TraceService {
  constructor(private readonly opts: TraceServiceOptions) {}

  get(claudeSessionId: string): SessionTrace {
    return {
      claudeSessionId,
      turns: [],
      costUsd: null,
      durationMs: null,
      costliest: null,
      slowest: null,
    };
  }

  export(claudeSessionId: string, _includeContent: boolean): TraceExport {
    return { filename: `${claudeSessionId}.json`, json: "", redacted: 0 };
  }
}
