import { describe, expect, test } from "bun:test";
import { IDLE_CLOSE_MS, INTERRUPT_ESCALATION_MS } from "../../src/runtime/opencode-runtime.ts";
import { poll } from "../support/helpers.ts";
import { configOptions, turns } from "./fake-acp-agent.ts";
import { collect, setup, startOpts } from "./opencode-setup.ts";

describe("opencode-runtime-lifecycle", () => {
  test("no process until the first send; a failed start leaves no process and runs the preflight once", async () => {
    const lazy = setup();
    lazy.runtime.start(startOpts());
    expect(lazy.agents).toHaveLength(0);
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
    expect(agents).toHaveLength(0);
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
    expect(out.events.filter((e) => e.type === "session.init")).toHaveLength(1);
    expect(out.error).toBeNull();
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
