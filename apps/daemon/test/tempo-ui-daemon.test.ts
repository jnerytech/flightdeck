import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import type { OtlpEvent } from "../src/telemetry/otlp.ts";
import { TelemetryStore } from "../src/telemetry/store.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const TOKEN = "tempo-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const ev = (
  name: string,
  atMs: number,
  attrs: OtlpEvent["attrs"] = {},
  over: Partial<OtlpEvent> = {},
): OtlpEvent => ({ name, timeMs: T0 + atMs, sessionId: "s-1", promptId: "p-1", attrs, ...over });

/** One prompt with a tool the config allowed, a permission a person answered after 7 s, an API error. */
const SESSION_EVENTS: OtlpEvent[] = [
  ev("user_prompt", 0, { prompt_length: 20 }),
  ev("api_request", 1_000, { request_id: "r1", duration_ms: 800, cost_usd: 0.01 }),
  ev("tool_decision", 1_100, {
    tool_use_id: "t1",
    tool_name: "Read",
    decision: "accept",
    source: "config",
  }),
  ev("tool_result", 1_300, {
    tool_use_id: "t1",
    tool_name: "Read",
    duration_ms: 150,
    success: "true",
  }),
  ev("api_request", 2_000, { request_id: "r2", duration_ms: 700, cost_usd: 0.02 }),
  ev("tool_decision", 9_000, {
    tool_use_id: "t2",
    tool_name: "Bash",
    decision: "accept",
    source: "user_temporary",
  }),
  ev("tool_result", 12_000, {
    tool_use_id: "t2",
    tool_name: "Bash",
    duration_ms: 2_900,
    success: "false",
    error_type: "ShellError",
  }),
  ev("api_error", 13_000, { request_id: "r3", status_code: 529, duration_ms: 90 }),
  ev(
    "api_request",
    40_000,
    { request_id: "r4", duration_ms: 500, cost_usd: 0.03 },
    { promptId: "p-2" },
  ),
  ev(
    "tool_result",
    41_000,
    { tool_use_id: "t3", tool_name: "Edit", duration_ms: 40, success: "true" },
    { promptId: null },
  ),
];

function setup() {
  const db = new EventStore(":memory:").db;
  const telemetry = new TelemetryStore(db);
  telemetry.add(SESSION_EVENTS);
  return { db, telemetry };
}

describe("tempo-ui: the timeline of a session", () => {
  test("prompts in order, each with its steps, its cost and the time a person kept it waiting", () => {
    const { telemetry } = setup();
    const { prompts } = telemetry.timeline("s-1");
    expect(prompts.map((p) => p.promptId)).toEqual(["p-1", "p-2", null]);
    const [first, second, loose] = prompts;
    expect(first).toMatchObject({ startedAt: T0, endedAt: T0 + 13_000, waitMs: 7_000 });
    expect(first?.costUsd).toBeCloseTo(0.03, 10);
    expect(first?.items.map((i) => [i.kind, i.toolName, i.waitMs])).toEqual([
      ["api", null, null],
      ["permission", "Read", null],
      ["tool", "Read", null],
      ["api", null, null],
      ["permission", "Bash", 7_000],
      ["tool", "Bash", null],
      ["error", null, null],
    ]);
    expect(first?.items[5]).toMatchObject({
      durationMs: 2_900,
      success: false,
      error: "ShellError",
    });
    expect(first?.items[4]).toMatchObject({ decision: "accept", source: "user_temporary" });
    expect(first?.items[6]).toMatchObject({ error: "529", durationMs: 90 });
    expect(second).toMatchObject({ startedAt: T0 + 40_000, waitMs: 0 });
    expect(loose?.items.map((i) => i.toolName)).toEqual(["Edit"]);
    expect(telemetry.timeline("nobody")).toEqual({ prompts: [] });
  });
});

describe("tempo-ui: the summary per project", () => {
  test("permission wait and slowest tools, by the project the session's transcripts belong to", () => {
    const { db, telemetry } = setup();
    telemetry.add([
      ev(
        "tool_result",
        100,
        { tool_use_id: "a", tool_name: "Bash", duration_ms: 1_000 },
        { sessionId: "s-2" },
      ),
      ev(
        "tool_result",
        200,
        { tool_use_id: "b", tool_name: "Bash", duration_ms: 3_000 },
        { sessionId: "s-2" },
      ),
      ev(
        "tool_result",
        300,
        { tool_use_id: "c", tool_name: "Read", duration_ms: 100 },
        { sessionId: "s-2" },
      ),
      ev(
        "tool_decision",
        5_300,
        { tool_use_id: "c", tool_name: "Read", decision: "reject", source: "user_reject" },
        { sessionId: "s-2" },
      ),
      ev(
        "tool_result",
        1,
        { tool_use_id: "z", tool_name: "Bash", duration_ms: 9_999 },
        { sessionId: "unmapped" },
      ),
    ]);
    const entry = (id: string, session: string, project: string) =>
      db
        .query(
          `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
             speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
           VALUES (?, ?, '2026-11-01T12:00:00.000Z', '2026-11-01', ?, 'm', 'terminal', 'standard', 1, 1, 0, 0, 0, 0)`,
        )
        .run(id, session, project);
    entry("m1", "s-1", "proj-a");
    entry("m2", "s-2", "proj-b");
    expect(telemetry.summary()).toEqual({
      projects: [
        {
          projectKey: "proj-a",
          waitMs: 7_000,
          slowest: [
            { toolName: "Bash", calls: 1, avgMs: 2_900, maxMs: 2_900 },
            { toolName: "Read", calls: 1, avgMs: 150, maxMs: 150 },
            { toolName: "Edit", calls: 1, avgMs: 40, maxMs: 40 },
          ],
        },
        {
          projectKey: "proj-b",
          waitMs: 5_000,
          slowest: [
            { toolName: "Bash", calls: 2, avgMs: 2_000, maxMs: 3_000 },
            { toolName: "Read", calls: 1, avgMs: 100, maxMs: 100 },
          ],
        },
      ],
    });
  });
});

describe("tempo-ui: over the protocol", () => {
  async function served(withTelemetry: boolean) {
    const { telemetry } = setup();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      ...(withTelemetry ? { telemetry } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  }

  test("host.info announces it, and the two commands answer", async () => {
    const client = await served(true);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "telemetry",
    );
    const session = await client.data<{ prompts: unknown[] }>("telemetry.session", {
      claudeSessionId: "s-1",
    });
    expect(session?.prompts).toHaveLength(3);
    expect(await client.data("telemetry.summary", {})).toEqual({ projects: [] });
  });

  test("a host without it refuses the commands and does not announce it", async () => {
    const client = await served(false);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).not.toContain(
      "telemetry",
    );
    const ack = await client.request("telemetry.session", { claudeSessionId: "s-1" });
    expect(ack.ok).toBe(false);
  });
});
