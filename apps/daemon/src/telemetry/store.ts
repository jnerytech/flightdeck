import type { Database } from "bun:sqlite";
import type {
  SlowTool,
  TelemetryItem,
  TelemetryPrompt,
  TelemetrySession,
  TelemetrySummary,
} from "@flightdeck/protocol";
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

/** Slowest tools kept per project. */
const SLOWEST = 5;

/** Which events are steps of a prompt; the others (the prompt itself) only mark its time. */
const KINDS: Record<string, TelemetryItem["kind"] | undefined> = {
  tool_result: "tool",
  tool_decision: "permission",
  api_request: "api",
  api_error: "error",
};

/** A permission a person answered (not settings, a hook or the classifier). */
const person = (row: TelemetryRow) =>
  row.name === "tool_decision" && /^user_/.test(row.source ?? "");

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

  /** A session's prompts, each with its tools, permissions and API calls in order. */
  timeline(claudeSessionId: string): TelemetrySession {
    const rows = this.forSession(claudeSessionId);
    const prompts = new Map<string | null, TelemetryPrompt>();
    let before: TelemetryRow | undefined;
    for (const row of rows) {
      const waited = person(row) && before ? Math.max(0, row.at - before.at) : null;
      before = row;
      let prompt = prompts.get(row.promptId);
      if (!prompt) {
        prompt = {
          promptId: row.promptId,
          startedAt: row.at,
          endedAt: row.at,
          costUsd: 0,
          waitMs: 0,
          items: [],
        };
        prompts.set(row.promptId, prompt);
      }
      prompt.endedAt = Math.max(prompt.endedAt, row.at);
      const kind = KINDS[row.name];
      if (!kind) continue;
      prompt.costUsd += row.costUsd ?? 0;
      prompt.waitMs += waited ?? 0;
      prompt.items.push({
        kind,
        at: row.at,
        toolName: row.toolName,
        durationMs: row.durationMs,
        costUsd: row.costUsd,
        success: row.success,
        error: row.error,
        decision: row.decision,
        source: row.source,
        waitMs: waited,
      });
    }
    return { prompts: [...prompts.values()] };
  }

  /** Per project: permission wait and the slowest tools, over every session. */
  summary(): TelemetrySummary {
    const project = `(SELECT project_key FROM usage_entries u WHERE u.claude_session_id = e.claude_session_id
       ORDER BY u.at DESC LIMIT 1)`;
    const waits = this.db
      .query<{ projectKey: string; waitMs: number }, []>(
        `SELECT projectKey, TOTAL(gap) AS waitMs FROM (
           SELECT ${project} AS projectKey, e.name, e.source,
             e.at - LAG(e.at) OVER (PARTITION BY e.claude_session_id ORDER BY e.at, e.id) AS gap
           FROM telemetry_events e)
         WHERE projectKey IS NOT NULL AND name = 'tool_decision' AND source LIKE 'user\\_%' ESCAPE '\\'
         GROUP BY projectKey`,
      )
      .all();
    const tools = this.db
      .query<{ projectKey: string } & SlowTool, []>(
        `SELECT ${project} AS projectKey, e.tool_name AS toolName, COUNT(*) AS calls,
           AVG(e.duration_ms) AS avgMs, MAX(e.duration_ms) AS maxMs
         FROM telemetry_events e
         WHERE e.name = 'tool_result' AND e.tool_name IS NOT NULL AND e.duration_ms IS NOT NULL
         GROUP BY projectKey, e.tool_name HAVING projectKey IS NOT NULL
         ORDER BY avgMs DESC, toolName`,
      )
      .all();
    const keys = [...new Set([...waits, ...tools].map((r) => r.projectKey))].sort();
    return {
      projects: keys.map((projectKey) => ({
        projectKey,
        waitMs: waits.find((w) => w.projectKey === projectKey)?.waitMs ?? 0,
        slowest: tools
          .filter((t) => t.projectKey === projectKey)
          .slice(0, SLOWEST)
          .map(({ toolName, calls, avgMs, maxMs }) => ({ toolName, calls, avgMs, maxMs })),
      })),
    };
  }
}
