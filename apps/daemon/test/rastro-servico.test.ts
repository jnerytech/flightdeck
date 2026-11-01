import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { TelemetryStore } from "../src/telemetry/store.ts";
import { TraceService } from "../src/trace/service.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const SESSION = "bbbbbbbb-0000-4000-8000-000000000025";
const FIXTURES = join(import.meta.dir, "fixtures/trace");
const TOKEN = "trace-token-0123456789abcdef";
const PRICES: Record<string, number> = {
  msg_A: 0.1,
  msg_B: 0.2,
  msg_C: 0.05,
  msg_D: 0.01,
  msg_S1: 0.3,
  msg_S2: 0.02,
  msg_S3: 0.01,
  msg_R1: 0.04,
  msg_E: 0.06,
  msg_T1: 0.08,
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A store with the session indexed (its transcript copied under a project folder) and priced. */
function setup(options: { indexed?: boolean; telemetry?: boolean } = {}) {
  const db = new EventStore(":memory:").db;
  const project = join(tempDir("fd-trace-"), "projects", "proj");
  mkdirSync(join(project, SESSION), { recursive: true });
  cpSync(join(FIXTURES, "main.jsonl"), join(project, `${SESSION}.jsonl`));
  cpSync(join(FIXTURES, "subagents"), join(project, SESSION, "subagents"), { recursive: true });
  if (options.indexed !== false) {
    db.query(
      `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
       VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 3, 'external', ?)`,
    ).run(SESSION, join(project, `${SESSION}.jsonl`));
  }
  for (const [id, cost] of Object.entries(PRICES)) {
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES (?, ?, '2026-11-01T12:00:00.000Z', '2026-11-01', 'p', 'm', 'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
    ).run(id, SESSION, cost);
  }
  const telemetry = options.telemetry ? new TelemetryStore(db) : undefined;
  telemetry?.add([
    {
      name: "tool_result",
      timeMs: 1,
      sessionId: SESSION,
      promptId: null,
      attrs: { tool_use_id: "toolu_2", tool_name: "Bash", duration_ms: 9_500 },
    },
  ]);
  const service = new TraceService({
    db,
    scanner: new SecretScanner(),
    ...(telemetry ? { telemetry } : {}),
  });
  return { db, service, project };
}

describe("rastro-modelo: the service", () => {
  test("it reads the transcript and the subagents' from disk, and prices them from the usage entries", () => {
    const { service } = setup();
    const trace = service.get(SESSION);
    expect(trace.turns.map((t) => t.id)).toEqual(["turn:1", "turn:2"]);
    expect(trace.costUsd).toBeCloseTo(0.87, 10);
    expect(trace.turns[0]?.children.map((c) => c.id)).toContain("agent:a1");
    expect(trace.slowest).toBe("agent:a2");
  });

  test("a tool call's time is the telemetry's when the host has it", () => {
    const { service } = setup({ telemetry: true });
    const bash = service.get(SESSION).turns[0]?.children.find((c) => c.id === "tool:toolu_2");
    expect(bash?.durationMs).toBe(9_500);
  });

  test("a session that is not indexed, or whose file is gone, is refused with the reason the app knows", () => {
    const { service } = setup({ indexed: false });
    let error: unknown;
    try {
      service.get(SESSION);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FlightdeckError);
    expect((error as FlightdeckError).reason).toBe("transcript_not_indexed");
    const gone = setup();
    gone.db.query("UPDATE history_sessions SET file_path = '/nowhere/x.jsonl'").run();
    expect(() => gone.service.get(SESSION)).toThrow(FlightdeckError);
  });

  test("a session without a subagents folder is just its own turns", () => {
    const { db, project } = setup();
    rmSync(join(project, SESSION), { recursive: true });
    const bare = new TraceService({ db, scanner: new SecretScanner() });
    const trace = bare.get(SESSION);
    expect(trace.turns).toHaveLength(2);
    // The calls that started subagents stay plain tool calls.
    expect(trace.turns[0]?.children.map((c) => c.kind)).toEqual([
      "thinking",
      "tool",
      "tool",
      "tool",
    ]);
  });
});

describe("rastro-modelo: over the protocol", () => {
  async function served(withTrace: boolean) {
    const { service } = setup();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      ...(withTrace ? { trace: service } : {}),
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

  test("the host announces trace, and trace.get answers", async () => {
    const client = await served(true);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "trace",
    );
    const trace = await client.data<{ turns: unknown[] }>("trace.get", {
      claudeSessionId: SESSION,
    });
    expect(trace?.turns).toHaveLength(2);
  });

  test("a host without it says the feature is off", async () => {
    const client = await served(false);
    const ack = (await client.request("trace.get", { claudeSessionId: SESSION })) as {
      ok: boolean;
      error?: { reason?: string };
    };
    expect(ack.ok).toBe(false);
    expect(ack.error?.reason).toBe("feature_off");
  });
});
