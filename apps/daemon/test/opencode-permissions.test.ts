import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
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

function setup(canUseTool: CanUseToolFn, over: Partial<StartOptions> = {}, consume = true) {
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
  const reader = async () => {
    try {
      for await (const event of run.events) out.events.push(event);
    } catch (error) {
      out.error = error;
    }
  };
  if (consume) void reader();
  return { run, agents, out, reader };
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

  test("reads, globs and greps whose real path is inside the folder are allowed without a question", async () => {
    const root = realTempDir("fd-oc-perm-");
    const cwd = join(root, "project");
    const outside = join(root, "outside");
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(cwd, "src", "a.ts"), "x");
    writeFileSync(join(cwd, ".env"), "SECRET=1");
    writeFileSync(join(outside, "secret.txt"), "x");
    // A junction on Windows: a directory link that needs no admin rights.
    symlinkSync(outside, join(cwd, "docs"), "junction");
    const asked: string[] = [];
    const ctx = setup(
      async (name, input) => {
        asked.push(
          `${name} ${String((input as { file_path?: string; path?: string }).file_path ?? (input as { path?: string }).path ?? "")}`,
        );
        return { behavior: "allow" };
      },
      { cwd },
    );
    const agent = await turn(ctx.run, ctx.agents);
    const read = (id: string, name: string, rawInput: Record<string, unknown>) =>
      agent.ask("session/request_permission", {
        sessionId: "ses_1",
        toolCall: { toolCallId: id, name, rawInput },
      });
    expect(await read("r1", "read", { path: join(cwd, "src", "a.ts") })).toEqual(selected("once"));
    expect(await read("r2", "glob", { pattern: "*.ts" })).toEqual(selected("once"));
    expect(await read("r3", "grep", { pattern: "x", path: "src" })).toEqual(selected("once"));
    expect(asked).toEqual([]);
    expect(await read("r4", "read", { path: join(cwd, "docs", "secret.txt") })).toEqual(
      selected("once"),
    );
    expect(await read("r5", "read", { path: join(outside, "secret.txt") })).toEqual(
      selected("once"),
    );
    expect(await read("r6", "read", { path: join(cwd, ".env") })).toEqual(selected("once"));
    expect(await read("r7", "read", { path: join(cwd, "missing.ts") })).toEqual(selected("once"));
    expect(asked).toEqual([
      `Read ${join(cwd, "docs", "secret.txt")}`,
      `Read ${join(outside, "secret.txt")}`,
      `Read ${join(cwd, ".env")}`,
      `Read ${join(cwd, "missing.ts")}`,
    ]);
  });

  test("a request whose run stopped at the card's barrier is cancelled without asking anyone", async () => {
    let asked = 0;
    const ctx = setup(
      async () => {
        asked++;
        return { behavior: "allow" };
      },
      {},
      false,
    );
    ctx.run.send("go");
    expect(await poll(() => (ctx.agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    const answer = (ctx.agents[0] as FakeAcpAgent).ask(
      "session/request_permission",
      shellRequest("t1"),
    );
    await turns(5);
    await ctx.run.close();
    expect(await answer).toEqual(cancelled);
    expect(asked).toBe(0);
  });

  test("a request that carries less input than an earlier update asks with the fuller one", async () => {
    const inputs: unknown[] = [];
    const ctx = setup(async (_name, input) => {
      inputs.push(input);
      return { behavior: "allow" };
    });
    const agent = await turn(ctx.run, ctx.agents);
    agent.update({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      name: "shell",
      status: "pending",
      rawInput: {},
    });
    agent.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
      rawInput: { command: "ls", cwd: "/w" },
    });
    await agent.ask("session/request_permission", {
      sessionId: "ses_1",
      toolCall: { toolCallId: "t1", name: "shell", rawInput: { cwd: "/w" } },
    });
    expect(inputs).toEqual([{ command: "ls", cwd: "/w" }]);
  });
});
