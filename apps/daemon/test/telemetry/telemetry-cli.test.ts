import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TelemetrySession, TelemetrySummary } from "@flightdeck/protocol";
import { runTelemetryCli, type TelemetryCliArgs } from "../../src/telemetry/telemetry-cli.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const AT = Date.UTC(2026, 10, 20, 12, 0, 0);
const STEP = {
  toolName: null,
  durationMs: null,
  costUsd: null,
  success: null,
  error: null,
  decision: null,
  source: null,
  waitMs: null,
};
const SESSION: TelemetrySession = {
  prompts: [
    {
      promptId: "p-1",
      startedAt: AT,
      endedAt: AT + 9_000,
      costUsd: 0.1234,
      waitMs: 3_000,
      items: [
        {
          ...STEP,
          kind: "tool",
          at: AT + 1_000,
          toolName: "Bash",
          durationMs: 1_200,
          success: true,
        },
        {
          ...STEP,
          kind: "tool",
          at: AT + 2_000,
          toolName: "Edit",
          durationMs: 80,
          success: false,
          error: "ENOENT",
        },
        {
          ...STEP,
          kind: "permission",
          at: AT + 5_000,
          toolName: "Bash",
          decision: "accept",
          source: "user_temporary",
          waitMs: 3_000,
        },
        { ...STEP, kind: "api", at: AT + 8_000, durationMs: 4_000, costUsd: 0.1 },
      ],
    },
    {
      promptId: null,
      startedAt: AT + 20_000,
      endedAt: AT + 21_000,
      costUsd: 0,
      waitMs: 0,
      items: [],
    },
  ],
};

const SUMMARY: TelemetrySummary = {
  projects: [
    {
      projectKey: "flightdeck",
      waitMs: 12_000,
      slowest: [
        { toolName: "Bash", calls: 3, avgMs: 120.4, maxMs: 400 },
        { toolName: "Edit", calls: 1, avgMs: 80, maxMs: 80 },
      ],
    },
    { projectKey: "other", waitMs: 0, slowest: [] },
  ],
};

/** The payload of the first command of a type the fake daemon received. */
const sent = (daemon: { calls: Array<{ type: string; payload: unknown }> }, type: string) =>
  daemon.calls.find((call) => call.type === type)?.payload;

const run = (args: TelemetryCliArgs, daemon: { port: number }) =>
  runTelemetryCli(args, config(daemon.port));

describe("telemetry session (issue #3755)", () => {
  test("asks for the session and prints one block per prompt with a line per step", async () => {
    const daemon = fakeDaemon({ "telemetry.session": () => SESSION });
    const result = await run({ action: "session", id: "abc-123" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "telemetry.session") }).toEqual(
      {
        code: 0,
        out: [
          "prompt p-1  2026-11-20T12:00:00.000Z to 2026-11-20T12:00:09.000Z  $0.1234  permission wait 3000 ms",
          "  tool  2026-11-20T12:00:01.000Z  Bash  1200 ms  ok",
          "  tool  2026-11-20T12:00:02.000Z  Edit  80 ms  failed  error ENOENT",
          "  permission  2026-11-20T12:00:05.000Z  Bash  accept by user_temporary  waited 3000 ms",
          "  api  2026-11-20T12:00:08.000Z  4000 ms  $0.1000",
          "prompt none  2026-11-20T12:00:20.000Z to 2026-11-20T12:00:21.000Z  $0.0000  permission wait 0 ms",
        ],
        sent: { claudeSessionId: "abc-123" },
      },
    );
  });

  test("a session with no prompts prints nothing and still exits 0", async () => {
    const daemon = fakeDaemon({ "telemetry.session": () => ({ prompts: [] }) });
    const result = await run({ action: "session", id: "abc-123" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "telemetry.session") }).toEqual(
      {
        code: 0,
        out: [],
        sent: { claudeSessionId: "abc-123" },
      },
    );
  });

  test("--json prints the daemon's answer as it is", async () => {
    const result = await run(
      { action: "session", id: "abc-123", json: true },
      fakeDaemon({ "telemetry.session": () => SESSION }),
    );
    expect(result.out).toEqual([JSON.stringify(SESSION, null, 2)]);
  });
});

describe("telemetry summary (issue #3755)", () => {
  test("prints one block per project: the wait, then each slow tool", async () => {
    const daemon = fakeDaemon({ "telemetry.summary": () => SUMMARY });
    const result = await run({ action: "summary" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "telemetry.summary") }).toEqual(
      {
        code: 0,
        out: [
          "flightdeck  permission wait 12000 ms",
          "  Bash  3 calls  avg 120 ms  max 400 ms",
          "  Edit  1 call  avg 80 ms  max 80 ms",
          "other  permission wait 0 ms",
        ],
        sent: {},
      },
    );
  });

  test("with no events it says so and exits 0", async () => {
    const result = await run(
      { action: "summary" },
      fakeDaemon({ "telemetry.summary": () => ({ projects: [] }) }),
    );
    expect({ code: result.code, out: result.out }).toEqual({ code: 0, out: ["no telemetry"] });
  });

  test("--json prints the daemon's answer as it is", async () => {
    const result = await run(
      { action: "summary", json: true },
      fakeDaemon({ "telemetry.summary": () => SUMMARY }),
    );
    expect(result.out).toEqual([JSON.stringify(SUMMARY, null, 2)]);
  });

  test("no daemon is exit 2", async () => {
    const result = await runTelemetryCli(
      { action: "summary" },
      { bind: "127.0.0.1", port: 1, token: "t" },
      { timeoutMs: 500 },
    );
    expect(result.code).toBe(2);
  });
});
