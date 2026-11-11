import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type ProcReader, Resources } from "../src/resources/resources.ts";
import { startServer } from "../src/server.ts";
import { newManager, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);
const TOKEN = "board-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const MB = 1024 * 1024;
const proc: ProcReader = {
  pageSize: 4096,
  ticksPerSecond: 100,
  pids: async () => [42, 500],
  stat: async (pid) =>
    pid === 42
      ? { pid: 42, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 100 }
      : {
          pid: 500,
          ppid: 42,
          name: "claude",
          cpuTicks: 0,
          startTicks: 1,
          rssPages: (50 * MB) / 4096,
        },
  cwd: async () => "/gone",
  uptimeSec: async () => 10_000,
};

async function serve(withResources = true) {
  const { root } = workspace();
  const killed: number[] = [];
  const server = startServer({
    manager: newManager({ allowedRoots: [root] }).manager,
    ...(withResources
      ? {
          resources: new Resources({
            proc,
            ownPid: 42,
            sessions: () => [
              {
                id: "old",
                name: null,
                cwd: "/gone",
                createdAt: "2020-01-01T00:00:00Z",
                updatedAt: "2100-01-01T00:00:00Z",
                active: false,
              },
            ],
            terminals: () => [],
            memory: () => ({ totalBytes: 1000, freeBytes: 400 }),
            disk: async () => null,
            loadPercent: () => null,
            kill: (pid) => void killed.push(pid),
          }),
        }
      : {}),
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
  return { client, killed };
}

describe("resources-server: over the wire (issue #154)", () => {
  test("a host with the sampler announces resources, and one without does not", async () => {
    const on = await serve();
    expect((await on.client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "resources",
    );
    const off = await serve(false);
    expect(
      (await off.client.data<{ features: string[] }>("host.info", {}))?.features,
    ).not.toContain("resources");
  });

  test("resources.get answers the snapshot, with the orphan and no command line", async () => {
    const { client } = await serve();
    const snap = await client.data<{
      memory: { totalBytes: number };
      orphans: Array<{ pid: number }>;
    }>("resources.get", {});
    expect(snap?.memory.totalBytes).toBe(1000);
    expect(snap?.orphans.map((o) => o.pid)).toEqual([500]);
    expect(JSON.stringify(snap)).not.toMatch(/--|SECRET/);
  });

  test("resources.endOrphan ends the orphan, and refuses a pid that is not one", async () => {
    const { client, killed } = await serve();
    const refused = await client.request("resources.endOrphan", { pid: 42, startTicks: 0 });
    expect(refused.ok).toBe(false);
    expect(killed).toEqual([]);
    const done = await client.data<{ ended: boolean }>("resources.endOrphan", {
      pid: 500,
      startTicks: 1,
    });
    expect(done?.ended).toBe(true);
    expect(killed).toEqual([500]);
  });

  test("without the sampler the commands say the feature is off", async () => {
    const { client } = await serve(false);
    const answer = await client.request("resources.get", {});
    expect(answer.ok).toBe(false);
  });

  test("the request is checked: a pid that is not a positive whole number, a missing start or an extra key is refused", async () => {
    const { client, killed } = await serve();
    for (const payload of [
      { pid: 0, startTicks: 1 },
      { pid: -1, startTicks: 1 },
      { pid: 1.5, startTicks: 1 },
      { pid: 500 },
      { pid: 500, startTicks: -1 },
      { pid: 500, startTicks: 1, extra: true },
    ]) {
      expect((await client.request("resources.endOrphan", payload)).ok).toBe(false);
    }
    expect(killed).toEqual([]);
  });
});
