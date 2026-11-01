import { afterEach, describe, expect, test } from "bun:test";
import { BgService } from "../src/bg/service.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { whichOnPath } from "../src/which.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "bg-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** What `claude agents --json --all` printed in Claude Code 2.1.31x: one entry per session. */
const AGENTS = [
  {
    cwd: "/work/app",
    kind: "background",
    startedAt: 1_793_534_400_000,
    id: "7c5dcf5d",
    state: "blocked",
    pid: 4242,
    status: "waiting",
    waitingFor: "permission prompt",
    sessionId: "11111111-2222-4333-8444-555555555555",
    name: "flaky-test-fix",
    somethingNew: { nested: true },
  },
  {
    cwd: "/work/app",
    kind: "background",
    startedAt: 1_793_534_000_000,
    id: "a1b2c3d4",
    state: "done",
  },
  { cwd: "/work/other", kind: "interactive", startedAt: 1_793_534_100_000, pid: 7, status: "idle" },
  { cwd: "/work/x", kind: "background", state: "working" },
];

function setup(options: { claude?: boolean } = {}) {
  const fake = installFakeClaude([]);
  cleanups.push(fake.restore);
  fake.setAgents(AGENTS);
  const db = new EventStore(":memory:").db;
  const service = new BgService({
    db,
    claude: () => (options.claude === false ? null : whichOnPath("claude")),
  });
  return { fake, db, service };
}

describe("bg-listar: the background sessions of the host", () => {
  test("it asks claude agents for every background session and keeps what the listing says of each", async () => {
    const { fake, service } = setup();
    const { supported, sessions } = await service.list();
    expect(supported).toBe(true);
    expect(fake.events().find((e) => e.type === "cli")?.args).toEqual([
      "agents",
      "--json",
      "--all",
    ]);
    expect(sessions).toEqual([
      {
        id: "7c5dcf5d",
        name: "flaky-test-fix",
        cwd: "/work/app",
        state: "blocked",
        status: "waiting",
        waitingFor: "permission prompt",
        pid: 4242,
        claudeSessionId: "11111111-2222-4333-8444-555555555555",
        startedAt: 1_793_534_400_000,
        costUsd: null,
      },
      {
        id: "a1b2c3d4",
        name: null,
        cwd: "/work/app",
        state: "done",
        status: null,
        waitingFor: null,
        pid: null,
        claudeSessionId: null,
        startedAt: 1_793_534_000_000,
        costUsd: null,
      },
    ]);
  });

  test("the cost is the session's, from the usage of its transcripts", async () => {
    const { db, service } = setup();
    for (const [id, cost] of [
      ["m1", 0.25],
      ["m2", 0.5],
    ] as const) {
      db.query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, '11111111-2222-4333-8444-555555555555', '2026-11-01T12:00:00.000Z', '2026-11-01', 'p', 'm',
           'terminal', 'standard', 1, 1, 0, 0, 0, ?)`,
      ).run(id, cost);
    }
    const { sessions } = await service.list();
    expect(sessions.map((s) => s.costUsd)).toEqual([0.75, null]);
  });

  test("a claude with no background sessions, none installed, or an answer that is not a list: not supported", async () => {
    const { fake, service } = setup();
    fake.failCli(true);
    expect(await service.list()).toEqual({ supported: false, sessions: [] });
    fake.failCli(false);
    fake.setAgents([]);
    expect(await service.list()).toEqual({ supported: true, sessions: [] });
    const none = setup({ claude: false });
    expect(await none.service.list()).toEqual({ supported: false, sessions: [] });
    const odd = setup();
    odd.fake.setAgents({ not: "a list" } as unknown as unknown[]);
    expect(await odd.service.list()).toEqual({ supported: false, sessions: [] });
  });
});

describe("bg-listar: over the protocol", () => {
  async function served(withBg: boolean) {
    const { service } = setup();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      ...(withBg ? { bg: service } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  }

  test("the host announces bg, and bg.list answers", async () => {
    const client = await served(true);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain("bg");
    const list = await client.data<{ supported: boolean; sessions: unknown[] }>("bg.list", {});
    expect(list?.sessions).toHaveLength(2);
  });

  test("a host without it says the feature is off", async () => {
    const client = await served(false);
    const ack = (await client.request("bg.list", {})) as {
      ok: boolean;
      error?: { reason?: string };
    };
    expect(ack.ok).toBe(false);
    expect(ack.error?.reason).toBe("feature_off");
  });
});
