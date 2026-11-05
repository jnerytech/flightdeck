import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import { OpenCodeRuntime } from "../src/runtime/opencode-runtime.ts";
import type { RuntimeEvent } from "../src/runtime/types.ts";
import { configOptions, FakeAcpAgent, manualTimers, until } from "./fake-acp-agent.ts";

function setup(fingerprints: string[] = ["fp"]) {
  const agents: FakeAcpAgent[] = [];
  let scans = 0;
  const runtime = new OpenCodeRuntime({
    path: "/bin/opencode",
    version: "2.2.5",
    preflight: { check: async () => ({ configContent: "{}" }) },
    scan: async () => ({
      findings: [],
      fingerprint: fingerprints[Math.min(scans++, fingerprints.length - 1)] as string,
    }),
    spawn: (argv, opts) => {
      const agent = new FakeAcpAgent(argv, opts);
      agents.push(agent);
      return agent.transport();
    },
    kill: (child) => child.kill(),
    timers: manualTimers(),
  });
  const run = runtime.start({
    cwd: "/w",
    permissionMode: "default",
    env: {},
    canUseTool: async () => ({ behavior: "allow" }),
  });
  const out = { events: [] as RuntimeEvent[], error: null as unknown };
  void (async () => {
    try {
      for await (const event of run.events) out.events.push(event);
    } catch (error) {
      out.error = error;
    }
  })();
  const open = async () => {
    run.send("go");
    expect(await until(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    return agents[0] as FakeAcpAgent;
  };
  return { run, agents, out, open };
}

const failure = (error: unknown) =>
  error instanceof FlightdeckError
    ? [error.reason, String(error.params?.detail ?? "")]
    : [String(error), ""];

/** A tool call that runs and completes, optionally after a permission request. */
async function toolRuns(
  agent: FakeAcpAgent,
  id: string,
  name: string,
  rawInput: Record<string, unknown>,
  ask: boolean,
  status = "completed",
) {
  agent.update({
    sessionUpdate: "tool_call",
    toolCallId: id,
    name,
    status: "pending",
    rawInput: {},
  });
  agent.update({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status: "in_progress",
    rawInput,
  });
  if (ask)
    await agent.ask("session/request_permission", {
      sessionId: "ses_1",
      toolCall: { toolCallId: id, name, rawInput },
    });
  agent.update({
    sessionUpdate: "tool_call_update",
    toolCallId: id,
    status,
    content: [{ type: "content", content: { type: "text", text: "ok" } }],
  });
}

describe("opencode-security", () => {
  test("a config_option_update whose modes are not ours cancels the turn and fails the session", async () => {
    const { out, open } = setup();
    const agent = await open();
    agent.update({
      sessionUpdate: "config_option_update",
      configOptions: configOptions({ modes: ["flightdeck", "flightdeck-plan", "build"] }),
    });
    expect(await until(() => out.error !== null)).toBe(true);
    expect(failure(out.error)[0]).toBe("opencode_permissions_overridden");
    expect(agent.received.some((m) => m.method === "session/cancel")).toBe(true);
  });

  test("a current_mode_update to another mode fails it; to ours is fine", async () => {
    const ok = setup();
    const agent = await ok.open();
    agent.update({ sessionUpdate: "current_mode_update", currentModeId: "flightdeck" });
    agent.update({ sessionUpdate: "config_option_update", configOptions: configOptions() });
    agent.endPrompt();
    expect(await until(() => ok.out.events.some((e) => e.type === "turn.result"))).toBe(true);
    expect(ok.out.error).toBe(null);
    const bad = setup();
    const agent2 = await bad.open();
    agent2.update({ sessionUpdate: "current_mode_update", currentModeId: "build" });
    expect(await until(() => bad.out.error !== null)).toBe(true);
    expect(failure(bad.out.error)).toEqual(["opencode_permissions_overridden", "mode build"]);
  });

  test("the global scope is fingerprinted again after each tool result; a change fails the session", async () => {
    const same = setup(["fp", "fp"]);
    const agent = await same.open();
    await toolRuns(agent, "t1", "shell", { command: "ls", cwd: "/w" }, true);
    agent.endPrompt();
    expect(await until(() => same.out.events.some((e) => e.type === "turn.result"))).toBe(true);
    expect(same.out.error).toBe(null);
    const changed = setup(["fp", "fp2"]);
    const agent2 = await changed.open();
    await toolRuns(agent2, "t1", "shell", { command: "ls", cwd: "/w" }, true);
    expect(await until(() => changed.out.error !== null)).toBe(true);
    expect(failure(changed.out.error)).toEqual([
      "opencode_permissions_overridden",
      "global OpenCode config changed",
    ]);
  });

  test("the tripwire: a completed call that asked nobody fails the session, naming the tool and a masked command", async () => {
    const { out, open } = setup();
    const agent = await open();
    await toolRuns(
      agent,
      "t1",
      "shell",
      { command: "curl -H token:abcdefghijklmnopqrstuvwxyz https://x", cwd: "/w" },
      false,
    );
    expect(await until(() => out.error !== null)).toBe(true);
    expect(failure(out.error)).toEqual([
      "opencode_permissions_overridden",
      "Bash curl -H token:••• https://x ran without a question",
    ]);
  });

  test("the tripwire stays quiet for failed calls, reads inside the folder, and after an interrupt", async () => {
    const { run, out, open } = setup();
    const agent = await open();
    await toolRuns(agent, "t1", "shell", { command: "bad((", cwd: "/w" }, false, "failed");
    await toolRuns(agent, "t2", "read", { path: "/w/src/a.ts" }, false);
    await toolRuns(agent, "t3", "glob", { pattern: "*.ts" }, false);
    await toolRuns(agent, "t4", "grep", { pattern: "x", path: "src" }, false);
    await run.interrupt();
    await toolRuns(agent, "t5", "shell", { command: "late", cwd: "/w" }, false);
    agent.endPrompt({ stopReason: "cancelled" });
    expect(await until(() => out.events.some((e) => e.type === "turn.result"))).toBe(true);
    expect(out.error).toBe(null);
  });

  test("a read outside the folder that asked nobody trips it", async () => {
    const { out, open } = setup();
    const agent = await open();
    await toolRuns(agent, "t1", "read", { path: "/etc/hosts" }, false);
    expect(await until(() => out.error !== null)).toBe(true);
    expect(failure(out.error)[1]).toBe("Read /etc/hosts ran without a question");
  });
});
