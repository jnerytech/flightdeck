import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionEvent } from "@flightdeck/protocol";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { OpenCodeRuntime } from "../src/runtime/opencode-runtime.ts";
import type { AgentRun, RuntimeEvent, StartOptions } from "../src/runtime/types.ts";
import { FakeAcpAgent, manualTimers } from "./fake-acp-agent.ts";
import { poll } from "./helpers.ts";

const ZWSP = "​";

function setup(over: Partial<StartOptions> = {}) {
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
  const run = runtime.start({
    cwd: "/w",
    permissionMode: "default",
    env: {},
    canUseTool: async () => ({ behavior: "allow" }),
    ...over,
  });
  const events: RuntimeEvent[] = [];
  void (async () => {
    for await (const event of run.events) events.push(event);
  })();
  return { run, agents, events };
}

/** Sends each text as its own turn and answers the prompts' blocks. */
async function prompts(run: AgentRun, agents: FakeAcpAgent[], texts: string[]): Promise<unknown[]> {
  for (const [i, text] of texts.entries()) {
    run.send(text);
    expect(await poll(() => (agents[0]?.calls("session/prompt").length ?? 0) === i + 1)).toBe(true);
    agents[0]?.endPrompt();
  }
  return agents[0]?.calls("session/prompt").map((p) => p.prompt) ?? [];
}

describe("opencode-commands", () => {
  test("a text that starts with / (after spaces) goes with a zero-width space first; other text is unchanged", async () => {
    const { run, agents } = setup();
    expect(
      await prompts(run, agents, ["/review src", "   /hello x", "say /hello", "plain"]),
    ).toEqual([
      [{ type: "text", text: `${ZWSP}/review src` }],
      [{ type: "text", text: `${ZWSP}   /hello x` }],
      [{ type: "text", text: "say /hello" }],
      [{ type: "text", text: "plain" }],
    ]);
  });

  test("session.init offers no slash commands, whatever OpenCode advertised", async () => {
    const { run, agents, events } = setup();
    run.send("x");
    expect(await poll(() => (agents[0]?.openPrompts ?? 0) === 1)).toBe(true);
    agents[0]?.update({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "evil" }],
    });
    agents[0]?.endPrompt();
    expect(await poll(() => events.some((e) => e.type === "turn.result"))).toBe(true);
    const init = events.find((e) => e.type === "session.init");
    expect(init !== undefined && "slashCommands" in init).toBe(false);
  });

  test("the folder's AGENTS.md goes first, once, as an embedded text resource; session.init names it", async () => {
    const cwd = realTempDir("fd-oc-agents-");
    writeFileSync(join(cwd, "AGENTS.md"), "Use tabs.\n@other.md\n");
    const { run, agents, events } = setup({ cwd });
    expect(await prompts(run, agents, ["first", "second"])).toEqual([
      [
        {
          type: "resource",
          resource: {
            uri: `file://${join(cwd, "AGENTS.md")}`,
            mimeType: "text/markdown",
            text: "Use tabs.\n@other.md\n",
          },
        },
        { type: "text", text: "first" },
      ],
      [{ type: "text", text: "second" }],
    ]);
    expect(events.find((e) => e.type === "session.init") as unknown).toEqual({
      type: "session.init",
      claudeSessionId: "ses_1",
      model: "opencode/crouton-alpha-free",
      tools: [],
      contextFiles: ["AGENTS.md"],
    });
  });

  test("a resumed session does not send AGENTS.md again", async () => {
    const cwd = realTempDir("fd-oc-agents-");
    writeFileSync(join(cwd, "AGENTS.md"), "x");
    const { run, agents } = setup({ cwd, resume: "ses_9" });
    expect(await prompts(run, agents, ["again"])).toEqual([[{ type: "text", text: "again" }]]);
  });

  test("an AGENTS.md over 64 KB is skipped and said so", async () => {
    const cwd = realTempDir("fd-oc-agents-");
    writeFileSync(join(cwd, "AGENTS.md"), "a".repeat(64 * 1024 + 1));
    const { run, agents, events } = setup({ cwd });
    expect(await prompts(run, agents, ["first"])).toEqual([[{ type: "text", text: "first" }]]);
    const init = events.find((e) => e.type === "session.init") as
      | { contextSkipped?: string[] }
      | undefined;
    expect(init?.contextSkipped).toEqual(["AGENTS.md"]);
  });

  test("the protocol carries contextFiles and contextSkipped on session.init", () => {
    const event = {
      type: "session.init",
      claudeSessionId: "s",
      model: "m",
      tools: [],
      contextFiles: ["AGENTS.md"],
      contextSkipped: ["AGENTS.md"],
    };
    expect(SessionEvent.parse(event) as unknown).toEqual(event);
  });
});
