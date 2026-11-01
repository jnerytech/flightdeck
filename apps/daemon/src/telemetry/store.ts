import type { Database } from "bun:sqlite";
import type { OtlpEvent } from "./otlp.ts";

/** One stored event of a terminal session's telemetry. */
export interface TelemetryRow {
  id: number;
  claudeSessionId: string;
  promptId: string | null;
  name: string;
  /** Epoch ms. */
  at: number;
  toolName: string | null;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  success: boolean | null;
  /** `error_type` of a tool, or the HTTP status of an API error. */
  error: string | null;
  decision: string | null;
  source: string | null;
}

export class TelemetryStore {
  constructor(private readonly db: Database) {}

  /** Stores the events; the ones already stored are skipped. Returns how many were new. */
  add(_events: OtlpEvent[]): number {
    return 0;
  }

  /** The events of a Claude session, oldest first. */
  forSession(_claudeSessionId: string): TelemetryRow[] {
    return [];
  }

  /** Deletes the events older than `days`; returns how many. */
  prune(_days: number, _now: number): number {
    return 0;
  }
}
