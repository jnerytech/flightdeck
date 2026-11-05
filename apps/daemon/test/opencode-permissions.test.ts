import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "../src/async-queue.ts";
import { FlightdeckError } from "../src/errors.ts";
import { OpenCodeRuntime } from "../src/runtime/opencode-runtime.ts";
import type {
  AgentRun,
  CanUseToolFn,
  PermissionDecision,
  RuntimeEvent,
  StartOptions,
} from "../src/runtime/types.ts";
import { FakeAcpAgent, manualTimers, turns } from "./fake-acp-agent.ts";
import { poll } from "./helpers.ts";

function setup(canUseTool: CanUseToolFn, over: Partial<StartOptions> = {}) {
  const agents: FakeAcpAgent[] = [];
  const runtime = new OpenCodeRuntime({
    path: "/bin/opencode",
    version: "2.2.5",
    preflight: { check: async () => ({ configContent: "{}" }) },
    scan: async () => ({ findings: [], fingerprint: "fp" }),
    spawn: (argv, opts) => {
      const agent = new FakeAcpAgent(argv, opts);
      agents.push(agent);
      return agent.transport();
    },
    kill: (child) => child.kill(),
    timers: manualTimers(),
  });
  const run = runtime.start({ cwd: "/w", permissionMode: "default", env: {}, canUseTool, ...over });
  const out = { events: [] as RuntimeEvent[], error: null as unknown };
  void (async () => {
    try {
      for await (const event of run.events) out.events.push(event);
    } catch (error) {
      out.error = error;
    }
  })();
  return { run, agents, out };
}

/** Starts a turn and answers once the prompt is open at the agent. */
async function turn(run: AgentRun, agents: FakeAcpAgent[]): Promise<FakeAcpAgent> {
  run.send("go");
  expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
  return agents[0] as FakeAcpAgent;
}

const shellRequest = (id: string, command = "ls", meta?: Record<string, unknown>) => ({
  sessionId: "ses_1",
  toolCall: {
    toolCallId: id,
    name: "shell",
    title: command,
    kind: "execute",
    status: "pending",
    rawInput: { command, cwd: "/w" },
    ...(meta ? { _meta: meta } : {}),
  },
  options: [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ],
});

const selected = (optionId: string) => ({ outcome: { outcome: "selected", optionId } });
const cancelled = { outcome: { outcome: "cancelled" } };

describe("opencode-permissions", () => {
  test("idle() resolves once the consumer took every item and waits for more", async () => {
    const queue = new AsyncQueue<number>();
    const seen: number[] = [];
    let idled = false;
    queue.push(1);
    queue.push(2);
    void queue.idle().then(() => {
      idled = true;
    });
    await turns(3);
    expect(idled).toBe(false);
    void (async () => {
      for await (const n of queue) seen.push(n);
    })();
    expect(await poll(() => idled)).toBe(true);
    expect(seen).toEqual([1, 2]);
    const ended = new AsyncQueue<number>();
    ended.end();
    let done = false;
    void ended.idle().then(() => {
      done = true;
    });
    expect(await poll(() => done)).toBe(true);
  });

  test("a request asks with Claude's name and input after its card was handled; allow answers once", async () => {
    const calls: Array<[string, unknown, string | undefined, number]> = [];
    let out: { events: RuntimeEvent[] } = { events: [] };
    const ctx = setup(async (name, input, info) => {
      calls.push([name, input, info.toolUseId, out.events.length]);
      return { behavior: "allow" };
    });
    out = ctx.out;
    const agent = await turn(ctx.run, ctx.agents);
    expect(await agent.ask("session/request_permission", shellRequest("t1"))).toEqual(
      selected("once"),
    );
    expect(calls).toEqual([["Bash", { command: "ls", cwd: "/w" }, "t1", 2]]);
    expect(out.events[1]).toEqual({
      type: "message.assistant",
      blocks: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls", cwd: "/w" } }],
    });
  });

  test("an allow with permanent rules still answers once: always is never sent", async () => {
    const ctx = setup(
      async () =>
        ({
          behavior: "allow",
          updatedPermissions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash" }],
              behavior: "allow",
              destination: "session",
            },
          ],
        }) as PermissionDecision,
    );
    const agent = await turn(ctx.run, ctx.agents);
    expect(await agent.ask("session/request_permission", shellRequest("t1"))).toEqual(
      selected("once"),
    );
  });

  test("a deny answers reject and cancels the session's other open requests", async () => {
    const signals = new Map<string, AbortSignal>();
    const decisions = new Map<string, (d: PermissionDecision) => void>();
    const ctx = setup(
      (_name, _input, info) =>
        new Promise((resolve) => {
          signals.set(info.toolUseId as string, info.signal);
          decisions.set(info.toolUseId as string, resolve);
        }),
    );
    const agent = await turn(ctx.run, ctx.agents);
    const first = agent.ask("session/request_permission", shellRequest("t1"));
    const second = agent.ask("session/request_permission", shellRequest("t2", "pwd"));
    expect(await poll(() => decisions.size === 2)).toBe(true);
    decisions.get("t1")?.({ behavior: "deny", message: "no" });
    expect(await first).toEqual(selected("reject"));
    expect(signals.get("t2")?.aborted).toBe(true);
    decisions.get("t2")?.({ behavior: "deny", message: "aborted" });
    expect(await second).toEqual(cancelled);
  });

  test("a child session's request is rejected without asking anyone and without a card", async () => {
    let asked = 0;
    const ctx = setup(async () => {
      asked++;
      return { behavior: "allow" };
    });
    const agent = await turn(ctx.run, ctx.agents);
    const child = shellRequest("ses_c:t9", "echo", { "opencode/child-session": { id: "ses_c" } });
    expect(await agent.ask("session/request_permission", child)).toEqual(selected("reject"));
    expect(asked).toBe(0);
    expect(ctx.out.events.some((e) => e.type === "message.assistant")).toBe(false);
  });

  test("bypassPermissions allows without asking when the host allows bypass", async () => {
    let asked = 0;
    const ctx = setup(
      async () => {
        asked++;
        return { behavior: "deny", message: "x" };
      },
      { permissionMode: "bypassPermissions", allowBypass: true },
    );
    const agent = await turn(ctx.run, ctx.agents);
    expect(await agent.ask("session/request_permission", shellRequest("t1"))).toEqual(
      selected("once"),
    );
    expect(asked).toBe(0);
  });

  test("an interrupt cancels a pending request and the turn", async () => {
    const ctx = setup(
      (_n, _i, info) =>
        new Promise((resolve) => {
          info.signal.addEventListener("abort", () =>
            resolve({ behavior: "deny", message: "cancelled" }),
          );
        }),
    );
    const agent = await turn(ctx.run, ctx.agents);
    const pending = agent.ask("session/request_permission", shellRequest("t1"));
    expect(await poll(() => ctx.out.events.length === 2)).toBe(true);
    await ctx.run.interrupt();
    expect(await pending).toEqual(cancelled);
    expect(agent.received.some((m) => m.method === "session/cancel")).toBe(true);
  });

  test("the live mode: plan and default switch our agent; acceptEdits, dontAsk and auto are refused", async () => {
    const ctx = setup(async () => ({ behavior: "allow" }));
    const agent = await turn(ctx.run, ctx.agents);
    await ctx.run.setPermissionMode?.("plan");
    await ctx.run.setPermissionMode?.("default");
    expect(agent.calls("session/set_config_option").map((p) => p.value)).toEqual([
      "flightdeck",
      "flightdeck-plan",
      "flightdeck",
    ]);
    for (const mode of ["acceptEdits", "dontAsk", "auto"] as const) {
      const refused = await ctx.run.setPermissionMode?.(mode).then(
        () => null,
        (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
      );
      expect(refused).toBe("runtime_unsupported");
    }
  });

  test("the live model: provider/model and its #variant; undefined goes back to the starting model", async () => {
    const ctx = setup(async () => ({ behavior: "allow" }), {
      model: "opencode/crouton-alpha-free",
    });
    const agent = await turn(ctx.run, ctx.agents);
    await ctx.run.setModel?.("anthropic/claude-sonnet-5-5#high");
    await ctx.run.setModel?.(undefined);
    expect(agent.calls("session/set_config_option").map((p) => `${p.configId}=${p.value}`)).toEqual(
      [
        "mode=flightdeck",
        "model=opencode/crouton-alpha-free",
        "model=anthropic/claude-sonnet-5-5",
        "effort=high",
        "model=opencode/crouton-alpha-free",
      ],
    );
  });
});
