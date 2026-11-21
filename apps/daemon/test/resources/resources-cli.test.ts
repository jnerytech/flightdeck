import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const MIB = 1024 * 1024;

const SNAPSHOT = {
  at: "2026-11-21T10:00:00.000Z",
  memory: { totalBytes: 8000 * MIB, freeBytes: 2000 * MIB },
  disk: { totalBytes: 100_000 * MIB, freeBytes: 40_000 * MIB },
  loadPercent: 35,
  measured: true,
  reason: null,
  rows: [
    {
      kind: "session",
      id: "s1",
      name: "fd-qa",
      cwd: "/w/api",
      rssBytes: 900 * MIB,
      cpuPercent: 12.5,
      processes: 4,
      names: ["claude", "bun"],
    },
    {
      kind: "terminal",
      id: "t1",
      name: null,
      cwd: null,
      rssBytes: 40 * MIB,
      cpuPercent: null,
      processes: 1,
      names: ["bash"],
    },
  ],
  orphans: [{ pid: 4242, name: "node", rssBytes: 300 * MIB, ageSec: 3600, startTicks: 987654 }],
  memoryPauseAt: 0.8,
  memoryHolding: false,
};

const base = (over: Handlers = {}): Handlers => ({ "resources.get": () => SNAPSHOT, ...over });

describe("the resources command line (issue #3699)", () => {
  test("`resources` is read as the command and takes nothing after it", () => {
    expect(parseArgs(["resources"]).command).toBe("resources");
    expect(parseArgs(["resources", "--json"])).toMatchObject({ command: "resources", json: true });
    expect(parseArgs(["resources", "--host", "pi"])).toMatchObject({
      command: "resources",
      host: "pi",
    });
    expect(() => parseArgs(["resources", "extra"])).toThrow();
  });
});

describe("flightdeckd resources (issue #3699)", () => {
  test("it prints memory, disk and load, the pause share, then a line per session or terminal and per orphan with its pid and start ticks", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["resources"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "memory  6000 of 8000 MiB used (75%)",
      "disk  60000 of 100000 MiB used (60%)",
      "load  35%",
      "pause  new cards wait from 80% of memory",
      "session  s1  fd-qa  900 MiB  cpu 12.5%  4 processes  claude, bun",
      "terminal  t1  -  40 MiB  cpu -  1 process  bash",
      "orphan  pid 4242  start-ticks 987654  node  300 MiB  age 3600s",
    ]);
    expect(daemon.calls.filter((c) => c.type === "resources.get")).toHaveLength(1);
  });

  test("a host that did not measure its processes says why, and one with no disk reading or pause says so", async () => {
    const daemon = fakeDaemon(
      base({
        "resources.get": () => ({
          ...SNAPSHOT,
          disk: null,
          loadPercent: null,
          measured: false,
          reason: "platform",
          rows: [],
          orphans: [],
          memoryPauseAt: null,
        }),
      }),
    );
    const run = await flightdeckd(["resources"], daemon.port);
    expect(run.out).toEqual([
      "memory  6000 of 8000 MiB used (75%)",
      "disk  not read",
      "load  not read",
      "pause  off",
      "processes not measured on this platform",
    ]);
  });

  test("the hold is shown when the host keeps new cards waiting now", async () => {
    const daemon = fakeDaemon(
      base({
        "resources.get": () => ({ ...SNAPSHOT, memoryHolding: true, orphans: [], rows: [] }),
      }),
    );
    const run = await flightdeckd(["resources"], daemon.port);
    expect(run.out).toContain("pause  new cards wait from 80% of memory  (holding now)");
  });

  test("--json prints every key, with null for what an older host leaves out", async () => {
    const daemon = fakeDaemon(
      base({
        "resources.get": () => {
          const { memoryPauseAt: _a, memoryHolding: _b, ...older } = SNAPSHOT;
          return older;
        },
      }),
    );
    const run = await flightdeckd(["resources", "--json"], daemon.port);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      ...SNAPSHOT,
      memoryPauseAt: null,
      memoryHolding: false,
    });
  });

  test("a daemon that refuses exits 1 with its text", async () => {
    const daemon = fakeDaemon({
      "resources.get": () => ({ error: { code: "feature_off", message: "resources are off" } }),
    });
    const run = await flightdeckd(["resources"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("resources are off"),
    ]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(base());
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["resources"], port);
    expect(run.code).toBe(2);
  });
});
