import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { createSessionManager } from "../../src/sessions/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { poll, sessionStarter, workspace } from "../support/helpers.ts";

/**
 * The session manager as main.ts builds it (issue #1593): the config, a folder's trust, the
 * keep-awake, the usage, the account and the snapshots reach it.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const store = new EventStore(":memory:");
  const { root, project } = workspace();
  cleanups.push(
    () => store.close(),
    () => rmSync(root, { recursive: true, force: true }),
  );
  const config = {
    allowedRoots: [root],
    defaultPermissionMode: "default" as const,
    allowApiKey: false,
    allowBypassPermissions: false,
  };
  const prepared: string[] = [];
  const active: number[] = [];
  const turns: string[] = [];
  const edges: string[] = [];
  let accountTurns = 0;
  const awake: { cardSession?: (sessionId: string) => boolean } = {};
  const manager = createSessionManager({
    store,
    runtime: new FakeRuntime({ delayMs: 1 }),
    baseEnv: {},
    config,
    projectTrust: {
      sessionTrust: () => ({ trusted: true }),
      prepare: async (cwd) => {
        prepared.push(cwd);
      },
    },
    keepAwake: { update: (count) => active.push(count) },
    awake,
    usage: { record: (sessionId, cwd) => turns.push(`${sessionId} ${cwd}`) },
    account: { turnEnded: () => accountTurns++ },
    snapshots: { enqueue: (input) => edges.push(`${input.kind} ${input.prompt ?? "-"}`) },
  });
  const start = sessionStarter(manager);
  const idle = (sessionId: string) => poll(() => manager.get(sessionId).status === "idle");
  return {
    manager,
    start,
    idle,
    project,
    config,
    awake,
    prepared,
    active,
    turns,
    edges,
    accountTurns: () => accountTurns,
  };
}

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
  );

describe("sessions-wiring: the session manager the daemon builds (#1593)", () => {
  test("a turn is counted in the usage and the account, its edges become snapshots", async () => {
    const s = setup();
    const { sessionId } = await s.start({ cwd: s.project, prompt: "hi" });
    expect(await s.idle(sessionId)).toBe(true);
    expect(await poll(() => s.edges.length === 2)).toBe(true);
    expect(s.prepared).toEqual([s.project]);
    expect(s.turns).toEqual([`${sessionId} ${s.project}`]);
    expect(s.accountTurns()).toBe(1);
    expect(s.edges).toEqual(["before hi", "after -"]);
    expect(s.active.includes(1)).toBe(true);
    expect(s.active.at(-1)).toBe(0);
  });

  test("a card's session stays awake; another one sleeps", async () => {
    const s = setup();
    const { sessionId } = await s.start({ cwd: s.project, prompt: "hi" });
    expect(await s.idle(sessionId)).toBe(true);
    s.awake.cardSession = (id) => id === sessionId;
    expect(await s.manager.sleep(sessionId)).toBe("kept_awake");
    s.awake.cardSession = () => false;
    expect(await s.manager.sleep(sessionId)).toBe("slept");
  });

  test("the bypass switch is read from the config at each start", async () => {
    const s = setup();
    const bypass = () =>
      s.start({ cwd: s.project, prompt: "hi", permissionMode: "bypassPermissions" });
    expect(await reasonOf(bypass())).toBe("bypass_not_allowed");
    s.config.allowBypassPermissions = true;
    const { sessionId } = await bypass();
    expect(await s.idle(sessionId)).toBe(true);
  });
});
