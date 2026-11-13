import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostPauseStatus } from "@flightdeck/protocol";
import { HostPause } from "../../src/board/domain/host-pause.ts";
import { loadConfig } from "../../src/config.ts";
import { startDaemon } from "../../src/main.ts";
import { MemoryGate } from "../../src/resources/memory-gate.ts";
import { startServer } from "../../src/server.ts";
import { cardWhen, gitRepo, newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

// Real git in a temp repository and a turn: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("host-pause: new card runs wait while the person has paused the host (#1404)", () => {
  test("paused holds, resumed lets go, and the watchers hear only a change", () => {
    const pause = new HostPause(false);
    let heard = 0;
    cleanups.push(pause.watch(() => heard++));
    expect([pause.paused(), pause.blocked()]).toEqual([false, null]);
    pause.set(true);
    pause.set(true);
    expect([pause.paused(), pause.blocked(), heard]).toEqual([true, { paused: true }, 1]);
    pause.set(false);
    expect([pause.paused(), pause.blocked(), heard]).toEqual([false, null, 2]);
    expect(new HostPause(true).blocked()).toEqual({ paused: true });
  });

  test("on the board, a card started on a paused host waits with reason paused and starts on resume", async () => {
    const pause = new HostPause(true);
    const ctx = newBoard({ pause });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Later", description: "oi" });
    expect(await ctx.board.startCard(card.id)).toMatchObject({
      queued: true,
      queueReason: "paused",
      sessionId: null,
    });
    pause.set(false);
    const started = await cardWhen(ctx.board, card.id, (c) => c.sessionId !== null);
    expect(started).toMatchObject({ queued: false, queueReason: null });
  });

  test("the pause is named before the other holds: the person's own choice comes first", async () => {
    const memory = new MemoryGate({
      pauseAt: 0.5,
      read: () => ({ totalBytes: 100, freeBytes: 1 }),
    });
    const ctx = newBoard({ pause: new HostPause(true), memory });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Both", description: "oi" });
    expect((await ctx.board.startCard(card.id)).queueReason).toBe("paused");
  });
});

const TOKEN = "host-pause-token-0123456789abcdef";

/** A daemon over a temp repository, with its config file. */
async function daemon(extra: object = {}) {
  const { root, repo } = gitRepo();
  const file = join(root, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(root, "data"),
      allowedRoots: [root],
      history: { roots: [join(root, "nada")] },
      ...extra,
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(running.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, file, repo };
}

describe("host-pause: the switch is the host's, in its config and host.info (#1404)", () => {
  test("host.pause writes the config, holds a card start, and resuming starts it", async () => {
    const { client, file, repo } = await daemon();
    const info = await client.data<{ features?: string[]; pause?: HostPauseStatus }>(
      "host.info",
      {},
    );
    expect([info?.features?.includes("hostPause"), info?.pause]).toEqual([
      true,
      { paused: false, running: 0 },
    ]);
    expect(await client.data("host.pause", { paused: true })).toEqual({ paused: true, running: 0 });
    expect((await loadConfig(file)).pauseNewRuns).toBe(true);
    const project = await client.data<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const card = await client.data<{ id: string }>("card.create", {
      projectId: project?.id,
      title: "Later",
      description: "oi",
    });
    const queued = await client.data<{ queueReason: string | null }>("card.start", {
      cardId: card?.id,
    });
    expect(queued?.queueReason).toBe("paused");
    expect(await client.data("host.pause", { paused: false })).toMatchObject({ paused: false });
    expect((await loadConfig(file)).pauseNewRuns).toBe(false);
  });

  test("a pause written in config.json holds after a restart", async () => {
    const { client } = await daemon({ pauseNewRuns: true });
    const info = await client.data<{ pause?: HostPauseStatus }>("host.info", {});
    expect(info?.pause?.paused).toBe(true);
  });

  test("only a near connection pauses or resumes a host", async () => {
    const pauses: boolean[] = [];
    const { root } = gitRepo();
    const { board, manager } = newBoard();
    cleanups.push(() => board.stop());
    const base = {
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
      hostPause: {
        status: () => ({ paused: false, running: 0 }),
        set: (p: boolean) => void pauses.push(p),
      },
    };
    const far = startServer({ ...base, peerOf: () => "8.8.8.8" });
    cleanups.push(() => far.stop());
    const client = new FrameClient(far.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const ack = await client.request("host.pause", { paused: true });
    expect([ack.ok, (ack.error as { reason?: string } | undefined)?.reason, pauses]).toEqual([
      false,
      "transport_refused",
      [],
    ]);
    // The host's own computer may.
    const near = startServer(base);
    cleanups.push(() => near.stop());
    const local = new FrameClient(near.url);
    cleanups.push(() => local.close());
    await local.request("hello", { token: TOKEN, client: "t" });
    expect([(await local.request("host.pause", { paused: true })).ok, pauses]).toEqual([
      true,
      [true],
    ]);
  });
});
