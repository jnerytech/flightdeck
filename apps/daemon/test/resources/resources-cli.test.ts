import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
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

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};
const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("the resources verbs of the command line (issue #3699)", () => {
  test("pause-at takes a share from 0 to 1 or off", () => {
    expect(parsed(["resources", "pause-at", "0.8"])).toMatchObject({
      command: "resources",
      action: "pause-at",
      resourcesPauseAt: 0.8,
    });
    expect(parsed(["resources", "pause-at", "off"])).toMatchObject({ resourcesPauseAt: null });
    expect(parsed(["resources", "pause-at", "1"])).toMatchObject({ resourcesPauseAt: 1 });
    for (const bad of ["2", "-0.1", "1.5", "0x1", "abc"]) {
      expect(parsed(["resources", "pause-at", bad])).toHaveProperty("refusal");
    }
    expect(parsed(["resources", "pause-at"])).toHaveProperty("refusal");
  });

  test("end-orphan takes the pid and the start ticks of the orphan the read printed", () => {
    expect(parsed(["resources", "end-orphan", "4242", "987654"])).toMatchObject({
      command: "resources",
      action: "end-orphan",
      orphanPid: 4242,
      orphanTicks: 987654,
    });
    expect(parsed(["resources", "end-orphan", "4242", "0"])).toMatchObject({ orphanTicks: 0 });
    for (const line of [
      ["end-orphan"],
      ["end-orphan", "4242"],
      ["end-orphan", "0", "1"],
      ["end-orphan", "abc", "1"],
      ["end-orphan", "4242", "-1"],
      ["end-orphan", "4242", "1.5"],
      ["end-orphan", "4242", "1", "extra"],
    ]) {
      expect(parsed(["resources", ...line])).toHaveProperty("refusal");
    }
  });

  test("--json goes with a verb, and --confirm goes with none", () => {
    expect(parsed(["resources", "pause-at", "off", "--json"])).toMatchObject({ json: true });
    expect(parsed(["resources", "end-orphan", "1", "1", "--confirm"])).toHaveProperty("refusal");
  });
});

describe("flightdeckd resources <verb> (issue #3699)", () => {
  test("pause-at sends the share (null for off) and prints the guard as the read does", async () => {
    const daemon = fakeDaemon({
      "resources.setPauseAt": (p) => ({ pauseAt: p.pauseAt }),
    });
    const on = await flightdeckd(["resources", "pause-at", "0.8"], daemon.port);
    expect({ code: on.code, out: on.out }).toEqual({
      code: 0,
      out: ["pause  new cards wait from 80% of memory"],
    });
    const off = await flightdeckd(["resources", "pause-at", "off", "--json"], daemon.port);
    expect(off.code).toBe(0);
    expect(JSON.parse(off.out.join("\n"))).toEqual({ pauseAt: null });
    expect(sent(daemon, "resources.setPauseAt")).toEqual([{ pauseAt: 0.8 }, { pauseAt: null }]);
  });

  test("end-orphan sends the pair and says it ended; a process that is no orphan any more exits 1 with the daemon's text", async () => {
    const daemon = fakeDaemon({ "resources.endOrphan": () => ({ ended: true }) });
    const run = await flightdeckd(["resources", "end-orphan", "4242", "987654"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["ended  pid 4242"] });
    expect(sent(daemon, "resources.endOrphan")).toEqual([{ pid: 4242, startTicks: 987654 }]);
    const json = await flightdeckd(["resources", "end-orphan", "4242", "1", "--json"], daemon.port);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out.join("\n"))).toEqual({ ended: true });
    const gone = fakeDaemon({
      "resources.endOrphan": () => ({
        error: { code: "invalid_state", message: "pid 4242 is not an orphan any more" },
      }),
    });
    const refused = await flightdeckd(["resources", "end-orphan", "4242", "1"], gone.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("not an orphan any more"),
    ]);
  });

  test("a connection lost while a write is in flight says it may or may not have happened", async () => {
    const daemon = fakeDaemon({ "resources.endOrphan": () => CLOSE });
    const run = await flightdeckd(["resources", "end-orphan", "4242", "1"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });
});
