import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as protocol from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "sleep-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(withSleep = true) {
  const ctx = newManager();
  let minutes = 0;
  const server = startServer({
    manager: ctx.manager,
    ...(withSleep
      ? { sleep: { minutes: () => minutes, set: (n: number) => void (minutes = n) } }
      : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { ...ctx, client, minutes: () => minutes };
}

describe("sleep-server: over the wire (issue #157)", () => {
  test("host.info says the delay, host.sleep sets it, and a host without the switch refuses", async () => {
    const on = await serve();
    expect(
      (await on.client.data<{ sleepAfterMinutes?: number }>("host.info", {}))?.sleepAfterMinutes,
    ).toBe(0);
    const set = await on.client.data<{ sleepAfterMinutes: number }>("host.sleep", { minutes: 30 });
    expect(set?.sleepAfterMinutes).toBe(30);
    expect(on.minutes()).toBe(30);
    expect(
      (await on.client.data<{ sleepAfterMinutes?: number }>("host.info", {}))?.sleepAfterMinutes,
    ).toBe(30);
    expect((await on.client.request("host.sleep", { minutes: -1 })).ok).toBe(false);
    const off = await serve(false);
    expect(
      (await off.client.data<{ sleepAfterMinutes?: number }>("host.info", {}))?.sleepAfterMinutes,
    ).toBeUndefined();
    expect((await off.client.request("host.sleep", { minutes: 5 })).ok).toBe(false);
  });

  test("session.sleep puts an idle session to sleep now and the list says asleep", async () => {
    const s = await serve();
    const { sessionId } = await s.manager.create({ cwd: s.project, prompt: "hello" });
    await poll(() => s.manager.get(sessionId).status === "idle");
    const result = await s.client.data<{ result: string }>("session.sleep", { sessionId });
    expect(result?.result).toBe("slept");
    const list = await s.client.data<{ sessions: Array<{ id: string; asleep?: boolean }> }>(
      "session.list",
      {},
    );
    expect(list?.sessions.find((x) => x.id === sessionId)?.asleep).toBe(true);
    const again = await s.client.data<{ result: string }>("session.sleep", { sessionId });
    expect(again?.result).toBe("already");
  });
});

describe("sleep-main: the config and what the host keeps awake", () => {
  async function boot(sessions?: object) {
    const dir = tempDir("fd-sleep-main-");
    const file = join(dir, "config.json");
    mkdirSync(join(dir, "proj"), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        hostName: "h",
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [dir],
        ...(sessions ? { sessions } : {}),
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, file, project: join(dir, "proj") };
  }

  test("it is off by default, the config can turn it on, and host.sleep keeps the choice in the file", async () => {
    const off = await boot();
    expect(
      (await off.client.data<protocol.HostInfoResult>("host.info", {}))?.sleepAfterMinutes,
    ).toBe(0);
    const on = await boot({ sleepAfterMinutes: 15 });
    expect(
      (await on.client.data<protocol.HostInfoResult>("host.info", {}))?.sleepAfterMinutes,
    ).toBe(15);
    await on.client.data("host.sleep", { minutes: 60 });
    expect(
      (await on.client.data<protocol.HostInfoResult>("host.info", {}))?.sleepAfterMinutes,
    ).toBe(60);
    expect(JSON.parse(readFileSync(on.file, "utf8")).sessions.sleepAfterMinutes).toBe(60);
  });

  test("a pinned session is never put to sleep, not even by hand", async () => {
    const h = await boot();
    const made = await h.client.data<{ sessionId: string }>("session.create", {
      cwd: h.project,
      prompt: "hi",
    });
    const id = made?.sessionId as string;
    const listed = async () =>
      (
        await h.client.data<{
          sessions: Array<{ id: string; status: string; claudeSessionId: string | null }>;
        }>("session.list", {})
      )?.sessions.find((s) => s.id === id);
    const ready = await poll(async () => (await listed())?.status === "idle", 5000);
    expect(ready).not.toBeNull();
    await h.client.data("session.meta.set", {
      claudeSessionId: (await listed())?.claudeSessionId,
      pinned: true,
    });
    expect(
      (await h.client.data<{ result: string }>("session.sleep", { sessionId: id }))?.result,
    ).toBe("kept_awake");
  });
});

describe("sleep-main: sessions of cards are left to the board", () => {
  test("hasRunSession tells a card's session from a plain one", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    await ctx.board.startCard(card.id);
    const sessionId = ctx.board.getCard(card.id).sessionId as string;
    expect(sessionId).toBeTruthy();
    expect(ctx.board.hasRunSession(sessionId)).toBe(true);
    expect(ctx.board.hasRunSession("not-a-session")).toBe(false);
    ctx.board.stop();
  });
});
