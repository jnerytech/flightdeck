import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SecretScanner, SessionTrace, TraceExport } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { TelemetryStore } from "../telemetry/store.ts";
import { buildTrace } from "./model.ts";

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
    const row = this.opts.db
      .query<{ path: string | null }, [string]>(
        "SELECT file_path AS path FROM history_sessions WHERE claude_session_id = ?",
      )
      .get(claudeSessionId);
    const missing = () =>
      new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    if (!row?.path || !existsSync(row.path)) throw missing();
    const folder = join(dirname(row.path), claudeSessionId, "subagents");
    const subagents = existsSync(folder)
      ? readdirSync(folder)
          .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
          .map((name) => ({
            id: name.slice("agent-".length, -".jsonl".length),
            text: readFileSync(join(folder, name), "utf8"),
          }))
      : [];
    const prices = new Map(
      this.opts.db
        .query<{ id: string; cost: number | null }, [string]>(
          "SELECT message_id AS id, cost_usd AS cost FROM usage_entries WHERE claude_session_id = ?",
        )
        .all(claudeSessionId)
        .map((entry) => [entry.id, entry.cost]),
    );
    const times = this.opts.telemetry?.toolDurations(claudeSessionId);
    return buildTrace({
      claudeSessionId,
      main: readFileSync(row.path, "utf8"),
      subagents,
      costOf: (id) => prices.get(id) ?? null,
      ...(times ? { toolMs: (id: string) => times.get(id) ?? null } : {}),
    });
  }

  export(claudeSessionId: string, _includeContent: boolean): TraceExport {
    return { filename: `${claudeSessionId}.json`, json: "", redacted: 0 };
  }
}
