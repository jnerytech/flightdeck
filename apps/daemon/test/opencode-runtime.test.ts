import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import type { SpawnedAcp } from "../src/runtime/acp/client.ts";
import {
  IDLE_CLOSE_MS,
  INTERRUPT_ESCALATION_MS,
  OpenCodeRuntime,
  type OpenCodeRuntimeOptions,
  treeKiller,
} from "../src/runtime/opencode-runtime.ts";
import type { AgentRun, RuntimeEvent, StartOptions } from "../src/runtime/types.ts";
import { configOptions, FakeAcpAgent, manualTimers, turns } from "./fake-acp-agent.ts";
import { poll } from "./helpers.ts";

const MCP = {
  name: "flightdeck",
  command: "/bin/flightdeckd",
  args: ["mcp"],
  env: [{ name: "FLIGHTDECK_SESSION", value: "fd1" }],
};

function setup(
  configure?: (agent: FakeAcpAgent) => void,
  over: Partial<OpenCodeRuntimeOptions> = {},
) {
  const agents: FakeAcpAgent[] = [];
  const timers = manualTimers();
  const killed: Array<[number, boolean]> = [];
  const checks: string[] = [];
  const runtime = new OpenCodeRuntime({
    path: "/bin/opencode",
    version: "2.2.5",
    preflight: {
      check: async (cwd) => {
        checks.push(cwd);
        return { configContent: '{"doc":1}' };
      },
    },
    scan: async () => ({ findings: [], fingerprint: "fp" }),
    spawn: (argv, opts) => {
      const agent = new FakeAcpAgent(argv, opts, 4242 + agents.length);
      configure?.(agent);
      agents.push(agent);
      return agent.transport();
    },
    kill: (child: SpawnedAcp, force: boolean) => {
      killed.push([child.pid, force]);
      child.kill();
    },
    timers,
    mcpServer: { command: "/bin/flightdeckd", args: ["mcp"] },
    ...over,
  });
  return { runtime, agents, timers, killed, checks };
}

const startOpts = (over: Partial<StartOptions> = {}): StartOptions => ({
  cwd: "/w",
  permissionMode: "default",
  env: { HOME: "/h", FLIGHTDECK_SESSION: "fd1", OPENCODE_DB: "/x" },
  canUseTool: async () => ({ behavior: "allow" }),
  ...over,
});

function collect(run: AgentRun) {
  const out = { events: [] as RuntimeEvent[], error: null as unknown, ended: false };
  void (async () => {
    try {
      for await (const event of run.events) out.events.push(event);
      out.ended = true;
    } catch (error) {
      out.error = error;
    }
  })();
  return out;
}

const reasonOf = (error: unknown) =>
  error instanceof FlightdeckError ? error.reason : String(error);
const methods = (agent: FakeAcpAgent | undefined) =>
  (agent?.received ?? []).flatMap((m) => (m.method ? [m.method] : []));

describe("opencode-runtime", () => {
  test("start: `<path> acp` in the folder with project config off, empty capabilities, the Flightdeck MCP, our mode before the first prompt", async () => {
    const { runtime, agents, checks } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("hi");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    const agent = agents[0] as FakeAcpAgent;
    expect(agent.argv).toEqual(["/bin/opencode", "acp"]);
    expect(agent.opts.cwd).toBe("/w");
    expect([
      agent.opts.env.OPENCODE_CONFIG_CONTENT,
      agent.opts.env.OPENCODE_DISABLE_PROJECT_CONFIG,
      agent.opts.env.OPENCODE_DB,
      agent.opts.env.FLIGHTDECK_SESSION,
    ]).toEqual(['{"doc":1}', "1", undefined, "fd1"]);
    expect(checks).toEqual(["/w"]);
    expect(methods(agent)).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(agent.calls("initialize")).toEqual([{ protocolVersion: 1, clientCapabilities: {} }]);
    expect(agent.calls("session/new")).toEqual([{ cwd: "/w", mcpServers: [MCP] }]);
    expect(agent.calls("session/set_config_option")).toEqual([
      { sessionId: "ses_1", configId: "mode", value: "flightdeck" },
    ]);
    expect(agent.calls("session/prompt")).toEqual([
      { sessionId: "ses_1", prompt: [{ type: "text", text: "hi" }] },
    ]);
    expect(out.events).toEqual([
      {
        type: "session.init",
        claudeSessionId: "ses_1",
        model: "opencode/crouton-alpha-free",
        tools: [],
      },
    ]);
    agent.endPrompt();
    expect(await poll(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
  });

  test("model, #variant and effort go through set_config_option; plan mode is flightdeck-plan", async () => {
    const first = setup();
    const run = first.runtime.start(
      startOpts({ model: "anthropic/claude-sonnet-5-5#high", permissionMode: "plan" }),
    );
    collect(run);
    run.send("x");
    expect(await poll(() => (first.agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(
      first.agents[0]?.calls("session/set_config_option").map((p) => [p.configId, p.value]),
    ).toEqual([
      ["mode", "flightdeck-plan"],
      ["model", "anthropic/claude-sonnet-5-5"],
      ["effort", "high"],
    ]);
    const second = setup();
    const run2 = second.runtime.start(
      startOpts({ model: "anthropic/claude-sonnet-5-5", effort: "low" }),
    );
    collect(run2);
    run2.send("x");
    expect(await poll(() => (second.agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(
      second.agents[0]?.calls("session/set_config_option").map((p) => [p.configId, p.value]),
    ).toEqual([
      ["mode", "flightdeck"],
      ["model", "anthropic/claude-sonnet-5-5"],
      ["effort", "low"],
    ]);
  });

  test("a resume uses session/resume with the stored id and no session/new", async () => {
    const { runtime, agents } = setup();
    const run = runtime.start(startOpts({ resume: "ses_9" }));
    const out = collect(run);
    run.send("again");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(agents[0]?.calls("session/resume")).toEqual([
      { sessionId: "ses_9", cwd: "/w", mcpServers: [MCP] },
    ]);
    expect(agents[0]?.calls("session/new")).toEqual([]);
    expect(agents[0]?.calls("session/prompt")[0]?.sessionId).toBe("ses_9");
    expect((out.events[0] as { claudeSessionId?: string } | undefined)?.claudeSessionId).toBe(
      "ses_9",
    );
  });

  test("mode options other than ours, or a mode that does not take, refuse before any prompt", async () => {
    const extra = setup((agent) => {
      agent.handlers["session/new"] = () => ({
        sessionId: "ses_1",
        configOptions: configOptions({ modes: ["flightdeck", "flightdeck-plan", "build"] }),
      });
    });
    const run = extra.runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => out.error !== null)).toBe(true);
    expect(reasonOf(out.error)).toBe("opencode_permissions_overridden");
    expect(extra.agents[0]?.calls("session/prompt")).toEqual([]);
    const stuck = setup((agent) => {
      agent.handlers["session/set_config_option"] = () => ({
        configOptions: configOptions({ mode: "build" }),
      });
    });
    const run2 = stuck.runtime.start(startOpts());
    const out2 = collect(run2);
    run2.send("x");
    expect(await poll(() => out2.error !== null)).toBe(true);
    expect(reasonOf(out2.error)).toBe("opencode_permissions_overridden");
  });

  test("acceptEdits, dontAsk and auto are refused without starting OpenCode", async () => {
    for (const permissionMode of ["acceptEdits", "dontAsk", "auto"] as const) {
      const { runtime, agents } = setup();
      const out = collect(runtime.start(startOpts({ permissionMode })));
      expect(await poll(() => out.error !== null)).toBe(true);
      expect(reasonOf(out.error)).toBe("runtime_unsupported");
      expect(agents.length).toBe(0);
    }
  });

  test("images become image blocks, and an empty text adds no text block", async () => {
    const { runtime, agents } = setup();
    const run = runtime.start(startOpts());
    collect(run);
    const image = { mediaType: "image/png" as const, data: "AAA" };
    run.send("", undefined, [image]);
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.endPrompt();
    run.send("look", undefined, [image]);
    expect(await poll(() => (agents[0]?.calls("session/prompt").length ?? 0) === 2)).toBe(true);
    expect(agents[0]?.calls("session/prompt").map((p) => p.prompt)).toEqual([
      [{ type: "image", mimeType: "image/png", data: "AAA" }],
      [
        { type: "image", mimeType: "image/png", data: "AAA" },
        { type: "text", text: "look" },
      ],
    ]);
  });

  test("auth_required is a typed session error; another prompt error is a runtime one", async () => {
    const { runtime, agents } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.failPrompt("auth_required");
    expect(await poll(() => out.events.some((e) => e.type === "session.error"))).toBe(true);
    const error = out.events.find((e) => e.type === "session.error") as
      | { code?: string; message?: string }
      | undefined;
    expect(error?.code).toBe("opencode_auth_required");
    expect(error?.message ?? "").toContain("opencode auth login");
    run.send("y");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.failPrompt("boom");
    expect(
      await poll(() => out.events.filter((e) => e.type === "session.error").length === 2),
    ).toBe(true);
    expect((out.events.at(-1) as { code?: string } | undefined)?.code).toBe("runtime");
  });

  test("an initialize with no answer in 30 s fails the run", async () => {
    const { runtime, agents, timers } = setup((agent) => {
      delete agent.handlers.initialize;
    });
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => methods(agents[0]).includes("initialize"))).toBe(true);
    timers.advance(30_000);
    expect(await poll(() => out.error !== null)).toBe(true);
  });

  test("interrupt cancels; with no answer in 10 s the process is closed and the turn ends in error; the next send resumes", async () => {
    const { runtime, agents, timers } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    await run.interrupt();
    expect(
      agents[0]?.received.filter((m) => m.method === "session/cancel").map((m) => m.params),
    ).toEqual([{ sessionId: "ses_1" }]);
    timers.advance(INTERRUPT_ESCALATION_MS);
    expect(await poll(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
    expect(out.events.find((e) => e.type === "turn.result")).toMatchObject({
      subtype: "error_during_execution",
      isError: true,
    });
    expect([methods(agents[0]).includes("session/close"), agents[0]?.alive]).toEqual([true, false]);
    run.send("again");
    expect(await poll(() => (agents[1]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(agents[1]?.calls("session/resume")[0]?.sessionId).toBe("ses_1");
    expect(out.error).toBe(null);
  });

  test("an interrupt OpenCode answers in time needs no escalation", async () => {
    const { runtime, agents, timers } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    await run.interrupt();
    agents[0]?.endPrompt({ stopReason: "cancelled" });
    expect(await poll(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
    timers.advance(INTERRUPT_ESCALATION_MS);
    expect(methods(agents[0]).includes("session/close")).toBe(false);
    expect(agents[0]?.alive).toBe(true);
  });

  test("close: session/close, stdin closed, a process that stays is killed 3 s later; twice is once", async () => {
    const { runtime, agents, timers, killed } = setup((agent) => {
      agent.exitOnStdinClose = false;
      delete agent.handlers["session/close"];
    });
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.endPrompt();
    const closing = run.close();
    const again = run.close();
    expect(await poll(() => methods(agents[0]).includes("session/close"))).toBe(true);
    timers.advance(2_000);
    expect(await poll(() => agents[0]?.stdinClosed === true)).toBe(true);
    timers.advance(3_000);
    await Promise.all([closing, again]);
    expect(killed).toEqual([[4242, false]]);
    expect(methods(agents[0]).filter((m) => m === "session/close").length).toBe(1);
    expect(await poll(() => out.ended)).toBe(true);
  });

  test("closed while it opens: the connection that just opened is closed too, and nothing is prompted", async () => {
    const opened = Promise.withResolvers<unknown>();
    const { runtime, agents } = setup((agent) => {
      agent.handlers["session/new"] = () => opened.promise;
    });
    const run = runtime.start(startOpts());
    run.send("x");
    expect(await poll(() => methods(agents[0]).includes("session/new"))).toBe(true);
    const closing = run.close();
    opened.resolve({ sessionId: "ses_1", configOptions: configOptions() });
    await closing;
    expect(await poll(() => methods(agents[0]).includes("session/close"))).toBe(true);
    expect(methods(agents[0]).includes("session/prompt")).toBe(false);
  });

  test("treeKiller: taskkill /T /F on Windows; elsewhere the process group, TERM then KILL, and the process if the group is gone", () => {
    const runs: string[][] = [];
    const groups: Array<[number, string]> = [];
    let plain = 0;
    const child = { pid: 77, kill: () => plain++ } as unknown as SpawnedAcp;
    const deps = {
      run: (argv: string[]) => runs.push(argv),
      killGroup: (pid: number, signal: NodeJS.Signals) => {
        groups.push([pid, signal]);
      },
    };
    treeKiller("win32", deps)(child, false);
    treeKiller("linux", deps)(child, false);
    treeKiller("linux", deps)(child, true);
    expect(runs).toEqual([["taskkill", "/PID", "77", "/T", "/F"]]);
    expect(groups).toEqual([
      [77, "SIGTERM"],
      [77, "SIGKILL"],
    ]);
    const gone = treeKiller("linux", {
      ...deps,
      killGroup: () => {
        throw new Error("ESRCH");
      },
    });
    gone(child, true);
    expect(plain).toBe(1);
  });

  test("a process that ignores stdin and the first kill gets a forced one, and close() never waits forever", async () => {
    const { runtime, agents, timers, killed } = setup((agent) => {
      agent.exitOnStdinClose = false;
      agent.survives = 99;
      delete agent.handlers["session/close"];
    });
    const run = runtime.start(startOpts());
    collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.endPrompt();
    let closed = false;
    void run.close().then(() => {
      closed = true;
    });
    expect(await poll(() => methods(agents[0]).includes("session/close"))).toBe(true);
    timers.advance(2_000);
    expect(await poll(() => agents[0]?.stdinClosed === true)).toBe(true);
    timers.advance(3_000);
    timers.advance(2_000);
    expect(killed).toEqual([
      [4242, false],
      [4242, true],
    ]);
    timers.advance(5_000);
    expect(await poll(() => closed)).toBe(true);
  });

  test("no process until the first send; a failed start leaves no process and runs the preflight once", async () => {
    const lazy = setup();
    lazy.runtime.start(startOpts());
    expect(lazy.agents.length).toBe(0);
    const extra = setup((agent) => {
      agent.handlers["session/new"] = () => ({
        sessionId: "ses_1",
        configOptions: configOptions({ modes: ["flightdeck", "flightdeck-plan", "build"] }),
      });
    });
    const run = extra.runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    run.send("y");
    expect(await poll(() => out.error !== null)).toBe(true);
    expect(await poll(() => extra.agents.every((a) => !a.alive))).toBe(true);
    expect([extra.agents.length, extra.checks.length]).toEqual([1, 1]);
  });

  test("a close during the preflight starts no process", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime, agents } = setup(undefined, {
      preflight: {
        check: async () => {
          await gate;
          return { configContent: "{}" };
        },
      },
    });
    const run = runtime.start(startOpts());
    collect(run);
    run.send("x");
    await run.close();
    release();
    await turns(20);
    expect(agents.filter((a) => a.alive).length).toBe(0);
  });

  test("an interrupt while the turn waits for its start cancels that turn; on an idle run it changes nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime, agents } = setup(undefined, {
      preflight: {
        check: async () => {
          await gate;
          return { configContent: "{}" };
        },
      },
    });
    const run = runtime.start(startOpts());
    const out = collect(run);
    await run.interrupt();
    run.send("x");
    await run.interrupt();
    release();
    expect(await poll(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
    expect(out.events.find((e) => e.type === "turn.result")).toMatchObject({
      subtype: "error_during_execution",
    });
    expect(agents[0]?.calls("session/prompt") ?? []).toEqual([]);
    run.send("y");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
  });

  test("a second interrupt leaves no timer that could end a later turn", async () => {
    const { runtime, agents, timers } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("one");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    await run.interrupt();
    await run.interrupt();
    agents[0]?.endPrompt({ stopReason: "cancelled" });
    expect(await poll(() => out.events.filter((e) => e.type === "turn.result").length === 1)).toBe(
      true,
    );
    run.send("two");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    timers.advance(INTERRUPT_ESCALATION_MS);
    agents[0]?.endPrompt();
    expect(await poll(() => out.events.filter((e) => e.type === "turn.result").length === 2)).toBe(
      true,
    );
    expect(out.events.filter((e) => e.type === "turn.result").at(-1)).toMatchObject({
      subtype: "success",
    });
    expect(agents[0]?.alive).toBe(true);
  });

  test("15 minutes after a turn the process closes; the next send runs the preflight again and resumes", async () => {
    const { runtime, agents, timers, checks } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.endPrompt();
    expect(await poll(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
    timers.advance(IDLE_CLOSE_MS);
    expect(await poll(() => agents[0]?.alive === false)).toBe(true);
    run.send("later");
    expect(await poll(() => (agents[1]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(checks).toEqual(["/w", "/w"]);
    expect(agents[1]?.calls("session/resume")[0]?.sessionId).toBe("ses_1");
    expect(out.events.filter((e) => e.type === "session.init").length).toBe(1);
    expect(out.error).toBe(null);
  });

  test("the process exiting by itself fails the run; the runtime's preflight is the preflight's check", async () => {
    const { runtime, agents, checks } = setup();
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.exit(1);
    expect(await poll(() => out.error !== null)).toBe(true);
    await runtime.preflight("/other");
    expect(checks).toEqual(["/w", "/other"]);
  });

  test("the process group is written to the ledger when OpenCode starts and released when it ends, by itself or closed (issue #250)", async () => {
    const events: string[] = [];
    const ledger = {
      add: (pid: number) => events.push(`add ${pid}`),
      release: (pid: number) => events.push(`release ${pid}`),
    };
    const { runtime, agents } = setup(undefined, { ledger });
    const run = runtime.start(startOpts());
    const out = collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    expect(events).toEqual(["add 4242"]);
    agents[0]?.exit(1);
    expect(await poll(() => out.error !== null)).toBe(true);
    expect(await poll(() => events.includes("release 4242"))).toBe(true);
    expect(events).toEqual(["add 4242", "release 4242"]);
  });

  test("a closed session releases its group once its process is gone", async () => {
    const events: string[] = [];
    const ledger = {
      add: (pid: number) => events.push(`add ${pid}`),
      release: (pid: number) => events.push(`release ${pid}`),
    };
    const { runtime, agents } = setup(undefined, { ledger });
    const run = runtime.start(startOpts());
    collect(run);
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    await run.close();
    expect(await poll(() => events.includes("release 4242"))).toBe(true);
    expect(events).toEqual(["add 4242", "release 4242"]);
  });
});
