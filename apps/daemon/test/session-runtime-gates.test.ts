import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "../src/async-queue.ts";
import { ExternalSessions } from "../src/central/external.ts";
import { Forker } from "../src/checkpoints/fork.ts";
import { FlightdeckError } from "../src/errors.ts";
import { LocalEndpoints } from "../src/messaging/endpoints.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "../src/runtime/types.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll } from "./helpers.ts";

/** An OpenCode stand-in whose first turn asks to run a shell command, then ends. */
class AskingOpenCode implements AgentRuntime {
  async preflight(): Promise<void> {}

  start(opts: StartOptions): AgentRun {
    const events = new AsyncQueue<RuntimeEvent>();
    return {
      events,
      send() {
        events.push({ type: "session.init", claudeSessionId: "ses_oc", model: "m", tools: [] });
        void opts
          .canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal })
          .then(() => {
            events.push({
              type: "turn.result",
              subtype: "success",
              isError: false,
              durationMs: 1,
              costUsd: 0.5,
            });
          });
      },
      async interrupt() {},
      async close() {
        events.end();
      },
    };
  }
}

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
  );

function setup() {
  let decided = 0;
  const turns: Array<[string, string]> = [];
  const store = new EventStore(":memory:");
  const ctx = newManager({
    store,
    opencode: new AskingOpenCode(),
    autoApprove: {
      decide: async () => {
        decided++;
        return null;
      },
    },
    onTurn: (sessionId, _cwd, _turn, runtime) => {
      turns.push([sessionId, String(runtime)]);
    },
  });
  return { ...ctx, store, turns, decided: () => decided };
}

describe("session-runtime-gates", () => {
  test("an OpenCode session's questions never go to the automatic approval; a person answers", async () => {
    const { manager, start, project, decided, store } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await poll(() => manager.get(sessionId).status === "awaiting_permission")).toBe(true);
    expect(decided()).toBe(0);
    expect(store.listSessions().length).toBe(1);
  });

  test("the turn callback says which runtime ran the turn", async () => {
    const { manager, start, project, turns } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await poll(() => manager.get(sessionId).status === "awaiting_permission")).toBe(true);
    const request = manager
      .eventsSince(sessionId)
      .find((e) => e.event.type === "permission.requested");
    manager.respondPermission({
      requestId: (request?.event as { requestId?: string } | undefined)?.requestId ?? "",
      decision: "allow",
    });
    expect(await poll(() => turns.length === 1)).toBe(true);
    expect(turns).toEqual([[sessionId, "opencode"]]);
  });

  test("MCP toggling and status answer runtime_unsupported for an OpenCode session", async () => {
    const { manager, start, project } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await reasonOf(manager.toggleMcpServer(sessionId, "x", false))).toBe(
      "runtime_unsupported",
    );
    expect(await reasonOf(manager.mcpStatus(sessionId))).toBe("runtime_unsupported");
  });

  test("messaging leaves OpenCode sessions out: not listed, and a message to one is refused", async () => {
    const { manager, start, project, store } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    const endpoints = new LocalEndpoints({
      manager,
      external: new ExternalSessions({ db: store.db, staleAfterS: 600 }),
      nameOf: () => null,
      projectKey: () => "p",
      cardOf: () => null,
      sendToLaunch: () => false,
    });
    expect(endpoints.list().map((e) => e.id)).toEqual([]);
    expect(() => endpoints.send(sessionId, "hello")).toThrow();
    endpoints.stop();
  });

  test("a fork of an OpenCode session is refused before anything runs", async () => {
    const { manager, start, project } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await poll(() => manager.get(sessionId).claudeSessionId === "ses_oc")).toBe(true);
    let forked = 0;
    const runtime = new FakeRuntime();
    runtime.forkSession = async () => {
      forked++;
      return { sessionId: "x" };
    };
    const forker = new Forker({ runtime, manager });
    expect(
      await reasonOf(forker.fork({ claudeSessionId: "ses_oc", cwd: project, open: "flightdeck" })),
    ).toBe("runtime_unsupported");
    expect(forked).toBe(0);
  });
});
