import { describe, expect, test } from "bun:test";
import { Costs } from "../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../src/costs/pricing.ts";
import { EventStore } from "../src/store/event-store.ts";
import type { OtlpEvent } from "../src/telemetry/otlp.ts";
import { TelemetryStore } from "../src/telemetry/store.ts";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const DAY = 86_400_000;

const event = (over: Partial<OtlpEvent> & { attrs?: OtlpEvent["attrs"] } = {}): OtlpEvent => ({
  name: "tool_result",
  timeMs: NOW,
  sessionId: "s-1",
  promptId: "p-1",
  attrs: {},
  ...over,
});

function store() {
  const db = new EventStore(":memory:").db;
  return { db, telemetry: new TelemetryStore(db) };
}

describe("telemetria-dados: the events", () => {
  test("they keep the session, the prompt, the name, the time and what the event measured", () => {
    const { telemetry } = store();
    const added = telemetry.add([
      event({
        timeMs: NOW + 1,
        attrs: {
          tool_name: "Bash",
          tool_use_id: "tu-1",
          duration_ms: 1500,
          success: "true",
          decision_source: "user_temporary",
        },
      }),
      event({
        name: "tool_decision",
        timeMs: NOW,
        attrs: {
          tool_name: "Bash",
          tool_use_id: "tu-1",
          decision: "accept",
          source: "user_temporary",
        },
      }),
      event({
        name: "api_request",
        timeMs: NOW + 2,
        attrs: {
          request_id: "rq-1",
          cost_usd: 0.0123,
          duration_ms: 4200,
          input_tokens: 10,
          output_tokens: 20,
          cache_read_tokens: 30,
          cache_creation_tokens: 40,
          model: "claude-opus-5-5",
        },
      }),
      event({
        name: "api_error",
        timeMs: NOW + 3,
        promptId: null,
        attrs: { request_id: "rq-2", status_code: 529, duration_ms: 90 },
      }),
      event({
        timeMs: NOW + 4,
        attrs: { tool_use_id: "tu-2", success: "false", error_type: "ShellError" },
      }),
    ]);
    expect(added).toBe(5);
    const rows = telemetry.forSession("s-1");
    expect(rows.map((r) => r.name)).toEqual([
      "tool_decision",
      "tool_result",
      "api_request",
      "api_error",
      "tool_result",
    ]);
    const [decision, tool, api, error, failed] = rows;
    expect(decision).toMatchObject({
      claudeSessionId: "s-1",
      promptId: "p-1",
      at: NOW,
      toolName: "Bash",
      decision: "accept",
      source: "user_temporary",
    });
    expect(tool).toMatchObject({ toolName: "Bash", durationMs: 1500, success: true, error: null });
    expect(api).toMatchObject({
      costUsd: 0.0123,
      durationMs: 4200,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      toolName: null,
    });
    expect(error).toMatchObject({ promptId: null, error: "529", durationMs: 90 });
    expect(failed).toMatchObject({ success: false, error: "ShellError" });
    expect(telemetry.forSession("other")).toEqual([]);
  });

  test("a batch sent again is not counted twice", () => {
    const { telemetry } = store();
    const batch = [
      event({ attrs: { tool_use_id: "tu-1" } }),
      event({ name: "api_request", attrs: { request_id: "rq-1" } }),
    ];
    expect(telemetry.add(batch)).toBe(2);
    expect(telemetry.add(batch)).toBe(0);
    expect(telemetry.add([event({ attrs: { tool_use_id: "tu-2" } })])).toBe(1);
    expect(telemetry.forSession("s-1")).toHaveLength(3);
  });

  test("values of the wrong kind are left empty instead of breaking the batch", () => {
    const { telemetry } = store();
    telemetry.add([
      event({ attrs: { duration_ms: "slow", cost_usd: true, input_tokens: "many", success: 3 } }),
    ]);
    expect(telemetry.forSession("s-1")[0]).toMatchObject({
      durationMs: null,
      costUsd: null,
      inputTokens: null,
      success: null,
    });
  });

  test("events older than the retention go, the rest stay", () => {
    const { telemetry } = store();
    telemetry.add([
      event({ timeMs: NOW - 31 * DAY, attrs: { tool_use_id: "old" } }),
      event({ timeMs: NOW - 29 * DAY, attrs: { tool_use_id: "recent" } }),
    ]);
    expect(telemetry.prune(30, NOW)).toBe(1);
    expect(telemetry.forSession("s-1").map((r) => r.at)).toEqual([NOW - 29 * DAY]);
    expect(telemetry.prune(30, NOW)).toBe(0);
  });
});

describe("telemetria-dados: the cost agrees with the transcripts", () => {
  function costsWith(rows: Array<{ id: string; session: string; at: string; cost: number }>) {
    const { db, telemetry } = store();
    for (const r of rows) {
      db.query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, ?, ?, ?, 'p', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      ).run(r.id, r.session, r.at, r.at.slice(0, 10), r.cost);
    }
    return { db, telemetry, costs: new Costs({ db, pricing: DEFAULT_PRICING }) };
  }
  const apiRequest = (session: string, timeMs: number, id: string, cost: number) =>
    event({
      name: "api_request",
      sessionId: session,
      timeMs,
      attrs: { request_id: id, cost_usd: cost },
    });
  const at = (ms: number) => new Date(ms).toISOString();

  test("a session whose two totals are far apart is listed in costs.status, with both numbers", () => {
    const { costs, telemetry } = costsWith([
      { id: "m1", session: "far", at: at(NOW), cost: 1 },
      { id: "m2", session: "close", at: at(NOW), cost: 10 },
      { id: "m3", session: "small", at: at(NOW), cost: 0.01 },
    ]);
    telemetry.add([
      apiRequest("far", NOW, "r1", 1.5),
      apiRequest("close", NOW, "r2", 10.9),
      apiRequest("small", NOW, "r3", 0.05),
    ]);
    expect(costs.status().telemetryDivergences).toEqual([
      { claudeSessionId: "far", computedUsd: 1, telemetryUsd: 1.5 },
    ]);
  });

  test("only the part of the session the exporter was on for counts, and a session with no telemetry is not compared", () => {
    const { costs, telemetry } = costsWith([
      // Before the exporter was on: not part of the comparison.
      { id: "m0", session: "late", at: at(NOW - 3_600_000), cost: 5 },
      { id: "m1", session: "late", at: at(NOW), cost: 2 },
      { id: "m2", session: "plain", at: at(NOW), cost: 9 },
    ]);
    telemetry.add([apiRequest("late", NOW, "r1", 2)]);
    expect(costs.status().telemetryDivergences).toEqual([]);
  });
});
