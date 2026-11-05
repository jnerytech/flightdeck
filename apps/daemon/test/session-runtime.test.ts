import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@flightdeck/protocol";
import { AsyncQueue } from "../src/async-queue.ts";
import { FlightdeckError } from "../src/errors.ts";
import type { AgentRun, AgentRuntime, RuntimeEvent, StartOptions } from "../src/runtime/types.ts";
import type { SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll } from "./helpers.ts";

/** An OpenCode stand-in: records preflights and starts, and can refuse or fail. */
class StubOpenCode implements AgentRuntime {
  readonly starts: StartOptions[] = [];
  readonly preflights: string[] = [];
  refuse: FlightdeckError | null = null;
  failRun: FlightdeckError | null = null;

  async preflight(cwd: string): Promise<void> {
    this.preflights.push(cwd);
    if (this.refuse) throw this.refuse;
  }

  start(opts: StartOptions): AgentRun {
    this.starts.push(opts);
    const events = new AsyncQueue<RuntimeEvent>();
    const fail = this.failRun;
    return {
      events,
      send() {
        if (fail) {
          events.fail(fail);
          return;
        }
        events.push({
          type: "session.init",
          claudeSessionId: "ses_oc",
          model: "anthropic/claude-sonnet-5-5",
          tools: [],
        });
        events.push({ type: "turn.result", subtype: "success", isError: false, durationMs: 1 });
      },
      async interrupt() {},
      async close() {
        events.end();
      },
    };
  }
}

const savedRules = () =>
  new FlightdeckError("invalid_state", "refused", "opencode_saved_rules", {
    version: "2.2.5",
    rules: "shell echo *",
  });

function setup(opencode: StubOpenCode | null = new StubOpenCode()) {
  const store = new EventStore(":memory:");
  const ctx = newManager({ store, ...(opencode ? { opencode } : {}) });
  return { ...ctx, opencode: opencode as StubOpenCode };
}

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
  );

const eventsOf = (manager: SessionManager, id: string): SessionEvent[] =>
  manager.eventsSince(id).map((e) => e.event as SessionEvent);

describe("session-runtime", () => {
  test("a session is Claude's unless it asks for OpenCode, and the summary says which", async () => {
    const { manager, start, project } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi" });
    expect(manager.get(sessionId).runtime).toBe("claude");
  });

  test("an OpenCode session runs the preflight first, is stored as opencode and starts on the OpenCode runtime", async () => {
    const { manager, start, project, runtime, opencode } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(opencode.preflights).toEqual([project]);
    expect(opencode.starts.length).toBe(1);
    expect((runtime as unknown as { starts?: unknown[] }).starts?.length ?? 0).toBe(0);
    expect(manager.get(sessionId).runtime).toBe("opencode");
    expect(await poll(() => manager.get(sessionId).status === "idle")).toBe(true);
    expect(manager.get(sessionId).claudeSessionId).toBe("ses_oc");
  });

  test("refusals leave no session: unavailable, a persona, an unsupported mode, a failed preflight", async () => {
    const none = setup(null);
    expect(await reasonOf(none.start({ cwd: none.project, runtime: "opencode" }))).toBe(
      "runtime_unavailable",
    );
    const ctx = setup();
    expect(
      await reasonOf(
        ctx.manager.create({
          cwd: ctx.project,
          runtime: "opencode",
          persona: { id: "x" },
        } as never),
      ),
    ).toBe("runtime_unsupported");
    expect(
      await reasonOf(
        ctx.start({ cwd: ctx.project, runtime: "opencode", permissionMode: "acceptEdits" }),
      ),
    ).toBe("runtime_unsupported");
    ctx.opencode.refuse = savedRules();
    expect(await reasonOf(ctx.start({ cwd: ctx.project, runtime: "opencode" }))).toBe(
      "opencode_saved_rules",
    );
    expect([
      none.manager.list().length,
      ctx.manager.list().length,
      ctx.opencode.starts.length,
    ]).toEqual([0, 0, 0]);
  });

  test("a resume runs the preflight again and resumes on the OpenCode runtime with the stored id", async () => {
    const { manager, start, project, opencode } = setup();
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await poll(() => manager.get(sessionId).status === "idle")).toBe(true);
    await manager.close(sessionId);
    await manager.resume(sessionId);
    expect(opencode.preflights).toEqual([project, project]);
    expect(opencode.starts.at(-1)?.resume).toBe("ses_oc");
    await manager.close(sessionId);
    opencode.refuse = savedRules();
    expect(await reasonOf(manager.resume(sessionId))).toBe("opencode_saved_rules");
    expect(manager.get(sessionId).status).toBe("ended");
  });

  test("a lazy reattach after a daemon restart uses the stored runtime; two sends start one run", async () => {
    const store = new EventStore(":memory:");
    const opencode = new StubOpenCode();
    const first = newManager({ store, opencode });
    const { sessionId } = await first.start({
      cwd: first.project,
      prompt: "hi",
      runtime: "opencode",
    });
    expect(await poll(() => first.manager.get(sessionId).status === "idle")).toBe(true);
    const restarted = new StubOpenCode();
    const second = newManager({ store, opencode: restarted, allowedRoots: [first.root] });
    second.manager.send(sessionId, "one");
    second.manager.send(sessionId, "two");
    expect(restarted.starts.map((s) => s.resume)).toEqual(["ses_oc"]);
  });

  test("a run that fails with a typed refusal leaves a typed session.error and the session in error", async () => {
    const { manager, start, project, opencode } = setup();
    opencode.failRun = new FlightdeckError(
      "invalid_state",
      "overridden",
      "opencode_permissions_overridden",
      {
        detail: "mode build",
      },
    );
    const { sessionId } = await start({ cwd: project, prompt: "hi", runtime: "opencode" });
    expect(await poll(() => manager.get(sessionId).status === "error")).toBe(true);
    expect(eventsOf(manager, sessionId).find((e) => e.type === "session.error")).toEqual({
      type: "session.error",
      code: "opencode_permissions_overridden",
      message: "overridden",
      reason: "opencode_permissions_overridden",
      params: { detail: "mode build" },
    });
  });

  test("a session resumed from the history stays Claude's", async () => {
    const { manager, project } = setup();
    const { sessionId } = await manager.createResumed({
      cwd: project,
      claudeSessionId: "c1",
      name: null,
    });
    expect(manager.get(sessionId).runtime).toBe("claude");
  });
});
