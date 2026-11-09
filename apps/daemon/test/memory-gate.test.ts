import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResourcesSnapshot } from "@flightdeck/protocol";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { MemoryGate, type MemoryReading, osMemoryReading } from "../src/resources/memory-gate.ts";
import type { ProcReader } from "../src/resources/resources.ts";
import { cardWhen, gitRepo, newBoard } from "./board-helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { manualTime } from "./time-helpers.ts";

// Real git in a temp repository and a turn: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const GB = 1024 ** 3;
/** A reading with this share of 16 GB in use. */
const used = (share: number): MemoryReading => ({
  totalBytes: 16 * GB,
  freeBytes: Math.round(16 * GB * (1 - share)),
});

/** A gate over a reading the test moves, on a manual clock. */
function gateAt(share: number, pauseAt: number | null = 0.9) {
  const time = manualTime();
  let reading: MemoryReading | null = used(share);
  const gate = new MemoryGate({ pauseAt, read: () => reading, timers: time.timers });
  return {
    ...time,
    gate,
    set: (next: MemoryReading | null) => {
      reading = next;
    },
  };
}

describe("memory-gate: new cards wait while the host's memory is at or above resources.pauseAt (#1343)", () => {
  test("95% in use holds new runs; 50% lets them go", () => {
    expect(gateAt(0.95).gate.blocked()).toEqual({ used: 0.95 });
    expect(gateAt(0.5).gate.blocked()).toBeNull();
    // The threshold itself holds, like the panel's Critical.
    expect(gateAt(0.9).gate.blocked()).toEqual({ used: 0.9 });
  });

  test("every doubt lets runs go: no threshold, no reading, a throw, a total of 0 or nonsense", () => {
    expect(gateAt(0.99, null).gate.blocked()).toBeNull();
    for (const reading of [
      null,
      { totalBytes: 0, freeBytes: 0 },
      { totalBytes: Number.NaN, freeBytes: 1 },
      { totalBytes: 16 * GB, freeBytes: -1 },
      { totalBytes: 16 * GB, freeBytes: 17 * GB },
    ]) {
      const g = gateAt(0.99);
      g.set(reading);
      expect([reading, g.gate.blocked()]).toEqual([reading, null]);
    }
    const throwing = new MemoryGate({
      pauseAt: 0.9,
      read: () => {
        throw new Error("no /proc");
      },
    });
    expect(throwing.blocked()).toBeNull();
  });

  test("Linux, WSL and Windows readings count; macOS, which counts its cache as used, does not", () => {
    const os = (platform: NodeJS.Platform) => ({
      platform,
      totalmem: () => 16 * GB,
      freemem: () => 6 * GB,
    });
    for (const platform of ["linux", "win32"] as const) {
      expect([platform, osMemoryReading(os(platform))]).toEqual([
        platform,
        { totalBytes: 16 * GB, freeBytes: 6 * GB },
      ]);
    }
    expect(osMemoryReading(os("darwin"))).toBeNull();
  });

  test("once holding, it lets runs go only 2 points under the threshold, so it does not flap", () => {
    const g = gateAt(0.95);
    let heard = 0;
    cleanups.push(g.gate.watch(() => heard++));
    expect(g.gate.blocked()).toEqual({ used: 0.95 });
    g.set(used(0.89));
    g.advance(15_000);
    expect([g.gate.blocked(), heard]).toEqual([{ used: 0.89 }, 0]);
    g.set(used(0.87));
    g.advance(15_000);
    expect([g.gate.blocked(), heard]).toEqual([null, 1]);
    // Free again, it holds from the threshold itself, not from the margin.
    g.set(used(0.89));
    g.advance(15_000);
    expect([g.gate.blocked(), heard]).toEqual([null, 1]);
  });

  test("a new threshold applies at once and tells the watchers", () => {
    const g = gateAt(0.85);
    let heard = 0;
    const stop = g.gate.watch(() => heard++);
    cleanups.push(stop);
    expect(g.gate.blocked()).toBeNull();
    g.gate.setPauseAt(0.8);
    expect([g.gate.pauseAt(), g.gate.blocked(), heard]).toEqual([0.8, { used: 0.85 }, 1]);
    g.gate.setPauseAt(null);
    expect([g.gate.pauseAt(), g.gate.blocked(), heard]).toEqual([null, null, 2]);
  });

  test("a watched gate reads again on its own only while it holds, and speaks when the hold ends", () => {
    const g = gateAt(0.95);
    let heard = 0;
    const live = () => g.pending.filter((t) => !t.cleared).length;
    const stop = g.gate.watch(() => heard++);
    g.advance(15_000);
    expect([heard, live()]).toEqual([0, 1]);
    g.set(used(0.5));
    g.advance(15_000);
    // Released: nothing waits for memory, so an idle daemon keeps no timer (daemon-idle).
    expect([heard, live()]).toEqual([1, 0]);
    // The next start reads afresh; holding again, the poll comes back.
    g.set(used(0.97));
    expect(g.gate.blocked()).toEqual({ used: 0.97 });
    expect(live()).toBe(1);
    g.set(used(0.5));
    g.advance(15_000);
    expect([heard, live()]).toEqual([2, 0]);
    // Unwatched, it stops reading: no timer is left behind.
    g.set(used(0.97));
    g.gate.blocked();
    stop();
    expect([heard, live()]).toEqual([2, 0]);
  });

  test("a watched gate that does not hold keeps no timer", () => {
    const g = gateAt(0.5);
    cleanups.push(g.gate.watch(() => {}));
    expect(g.pending.filter((t) => !t.cleared).length).toBe(0);
  });

  test("on the board, a card waits with reason memory and starts when memory falls", async () => {
    const g = gateAt(0.95);
    const ctx = newBoard({ memory: g.gate });
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "Heavy", description: "oi" });
    expect(await ctx.board.startCard(card.id)).toMatchObject({
      queued: true,
      queueReason: "memory",
      sessionId: null,
    });
    g.set(used(0.5));
    g.advance(15_000);
    const started = await cardWhen(ctx.board, card.id, (c) => c.sessionId !== null);
    expect(started).toMatchObject({ queued: false, queueReason: null });
  });
});

const TOKEN = "memory-pause-token-0123456789abcdef";

/** A /proc with only the daemon in it: resources.get reads nothing of the machine. */
const proc = (ownPid: number): ProcReader => ({
  pageSize: 4096,
  ticksPerSecond: 100,
  pids: async () => [ownPid],
  stat: async (pid) => ({
    pid,
    ppid: 1,
    name: "flightdeckd",
    cpuTicks: 0,
    startTicks: 0,
    rssPages: 10,
  }),
  cwd: async () => "/gone",
  uptimeSec: async () => 10_000,
});

/** A daemon over a temp repository, its memory read from `reading`. */
async function daemon(reading: () => MemoryReading | null) {
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
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    { resourcesProc: proc(process.pid), memoryReading: reading },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(running.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, file, repo };
}

describe("memory-pause: the hold is a host setting the app reads and changes (#1343)", () => {
  test("the daemon's board waits on the host's reading: a card started at 95% is queued for memory", async () => {
    const { client, repo } = await daemon(() => used(0.95));
    const project = await client.data<{ id: string }>("project.add", {
      path: repo,
      promptTemplate: "",
    });
    const card = await client.data<{ id: string }>("card.create", {
      projectId: project?.id,
      title: "Heavy",
      description: "oi",
    });
    const started = await client.data<{ queued: boolean; queueReason: string | null }>(
      "card.start",
      {
        cardId: card?.id,
      },
    );
    expect([started?.queued, started?.queueReason]).toEqual([true, "memory"]);
  });

  test("resources.setPauseAt writes the config, answers the new value and resources.get agrees", async () => {
    const { client, file } = await daemon(() => used(0.5));
    expect((await loadConfig(file)).resources.pauseAt).toBe(0.9);
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features?.includes("memoryPause")).toBe(true);
    expect((await client.data<ResourcesSnapshot>("resources.get", {}))?.memoryPauseAt).toBe(0.9);

    expect(await client.data("resources.setPauseAt", { pauseAt: 0.8 })).toEqual({ pauseAt: 0.8 });
    expect((await loadConfig(file)).resources.pauseAt).toBe(0.8);
    expect((await client.data<ResourcesSnapshot>("resources.get", {}))?.memoryPauseAt).toBe(0.8);

    expect(await client.data("resources.setPauseAt", { pauseAt: null })).toEqual({ pauseAt: null });
    expect((await loadConfig(file)).resources.pauseAt).toBeNull();
  });
});
