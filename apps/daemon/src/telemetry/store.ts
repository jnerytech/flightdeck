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

interface Row {
  id: number;
  claude_session_id: string;
  prompt_id: string | null;
  name: string;
  at: number;
  tool_name: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  success: number | null;
  error: string | null;
  decision: string | null;
  source: string | null;
}

const DAY_MS = 86_400_000;

type Attrs = OtlpEvent["attrs"];
const text = (attrs: Attrs, key: string) => (typeof attrs[key] === "string" ? attrs[key] : null);
const num = (attrs: Attrs, key: string) => (typeof attrs[key] === "number" ? attrs[key] : null);

export class TelemetryStore {
  constructor(private readonly db: Database) {}

  /** Stores the events; the ones already stored are skipped. Returns how many were new. */
  add(events: OtlpEvent[]): number {
    const insert = this.db.query(
      `INSERT OR IGNORE INTO telemetry_events
         (claude_session_id, prompt_id, name, at, ref, tool_name, duration_ms, cost_usd, input_tokens,
          output_tokens, cache_read_tokens, cache_creation_tokens, success, error, decision, source)
       VALUES ($session, $prompt, $name, $at, $ref, $tool, $duration, $cost, $input, $output,
          $cacheRead, $cacheCreation, $success, $error, $decision, $source)`,
    );
    return this.db.transaction(() => {
      let added = 0;
      for (const { attrs, name, sessionId, promptId, timeMs } of events) {
        const status = num(attrs, "status_code");
        const success = text(attrs, "success");
        const changes = insert.run({
          $session: sessionId,
          $prompt: promptId,
          $name: name,
          $at: timeMs,
          $ref: text(attrs, "tool_use_id") ?? text(attrs, "request_id") ?? "",
          $tool: text(attrs, "tool_name"),
          $duration: num(attrs, "duration_ms"),
          $cost: num(attrs, "cost_usd"),
          $input: num(attrs, "input_tokens"),
          $output: num(attrs, "output_tokens"),
          $cacheRead: num(attrs, "cache_read_tokens"),
          $cacheCreation: num(attrs, "cache_creation_tokens"),
          $success: success === null ? null : Number(success === "true"),
          $error: text(attrs, "error_type") ?? (status === null ? null : String(status)),
          $decision: text(attrs, "decision"),
          $source: text(attrs, "source") ?? text(attrs, "decision_source"),
        }).changes;
        added += changes;
      }
      return added;
    })();
  }

  /** The events of a Claude session, oldest first. */
  forSession(claudeSessionId: string): TelemetryRow[] {
    return this.db
      .query<Row, [string]>(
        "SELECT * FROM telemetry_events WHERE claude_session_id = ? ORDER BY at, id",
      )
      .all(claudeSessionId)
      .map((r) => ({
        id: r.id,
        claudeSessionId: r.claude_session_id,
        promptId: r.prompt_id,
        name: r.name,
        at: r.at,
        toolName: r.tool_name,
        durationMs: r.duration_ms,
        costUsd: r.cost_usd,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        success: r.success === null ? null : r.success === 1,
        error: r.error,
        decision: r.decision,
        source: r.source,
      }));
  }

  /** Deletes the events older than `days`; returns how many. */
  prune(days: number, now: number): number {
    return this.db.query("DELETE FROM telemetry_events WHERE at < ?").run(now - days * DAY_MS)
      .changes;
  }
}
