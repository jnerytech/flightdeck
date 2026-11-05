import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { createResources } from "../src/resources/wiring.ts";

const MB = 1024 * 1024;

/** A session of /gone that is over, alive for the whole of this century so far. */
const OLD_SESSION = {
  id: "old",
  name: null,
  cwd: "/gone",
  status: "ended",
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2100-01-01T00:00:00Z",
};

const deps = (over: Partial<Parameters<typeof createResources>[0]> = {}) => ({
  platform: "linux" as NodeJS.Platform,
  ownPid: 42,
  dataDir: "/data",
  sessions: () => [
    {
      id: "a",
      name: "A",
      cwd: "/w",
      status: "running",
      createdAt: "2026-11-05T10:00:00Z",
      updatedAt: "2026-11-05T11:00:00Z",
    },
    {
      id: "b",
      name: null,
      cwd: "/w",
      status: "ended",
      createdAt: "2026-11-05T10:00:00Z",
      updatedAt: "2026-11-05T11:00:00Z",
    },
    {
      id: "c",
      name: "C",
      cwd: "/w",
      status: "error",
      createdAt: "2026-11-05T10:00:00Z",
      updatedAt: "2026-11-05T11:00:00Z",
    },
    {
      id: "d",
      name: "D",
      cwd: "/w",
      status: "awaiting_permission",
      createdAt: "2026-11-05T10:00:00Z",
      updatedAt: "2026-11-05T11:00:00Z",
    },
  ],
  terminals: () => [
    { terminalId: "t1", cwd: "/w", command: "bash", exitCode: null },
    { terminalId: "t2", cwd: "/w", command: "bash", exitCode: 0 },
  ],
  pidOf: (id: string) => (id === "t1" ? 77 : null),
  totalmem: () => 8000 * MB,
  freemem: () => 2000 * MB,
  loadavg: () => [2, 0, 0],
  cpus: () => 4,
  statfs: async () => ({ blocks: 1000, bsize: 1024, bavail: 250 }),
  kill: () => {},
  proc: undefined,
  ...over,
});

describe("resources-wiring: the daemon's own resources (issue #154)", () => {
  test("host numbers come from the OS: memory, load per core and the data disk", async () => {
    const snap = await createResources(deps()).snapshot();
    expect(snap.memory).toEqual({ totalBytes: 8000 * MB, freeBytes: 2000 * MB });
    expect(snap.loadPercent).toBe(50);
    expect(snap.disk).toEqual({ totalBytes: 1000 * 1024, freeBytes: 250 * 1024 });
  });

  test("only sessions that can still own a process count, and only live terminals", async () => {
    const proc = {
      pageSize: 4096,
      ticksPerSecond: 100,
      pids: async () => [],
      stat: async () => null,
      cwd: async () => null,
      uptimeSec: async () => 0,
    };
    const snap = await createResources(deps({ proc })).snapshot();
    expect(snap.rows.map((r) => `${r.kind}:${r.id}`).sort()).toEqual([
      "session:a",
      "session:d",
      "terminal:t1",
    ]);
  });

  test("a platform without /proc is not measured; a disk that cannot be read is null; no cores is no load", async () => {
    const snap = await createResources(
      deps({
        platform: "win32",
        statfs: async () => {
          throw new Error("no");
        },
        cpus: () => 0,
      }),
    ).snapshot();
    expect(snap.measured).toBe(false);
    expect(snap.disk).toBeNull();
    expect(snap.loadPercent).toBeNull();
  });

  test("on Windows there is no load average: it reads 0 and is not reported", async () => {
    const snap = await createResources(
      deps({ platform: "win32", loadavg: () => [0, 0, 0] }),
    ).snapshot();
    expect(snap.loadPercent).toBeNull();
  });

  test("ending an orphan signals the pid with SIGTERM", async () => {
    const signals: Array<[number, string]> = [];
    const proc = {
      pageSize: 4096,
      ticksPerSecond: 100,
      pids: async () => [42, 9],
      stat: async (pid: number) =>
        pid === 42
          ? { pid: 42, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 1 }
          : { pid: 9, ppid: 42, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 1 },
      cwd: async () => "/gone",
      uptimeSec: async () => 10_000,
    };
    await createResources(
      deps({
        proc,
        sessions: () => [OLD_SESSION],
        terminals: () => [],
        kill: (pid, sig) => void signals.push([pid, sig]),
      }),
    ).endOrphan(9, 1);
    expect(signals).toEqual([[9, "SIGTERM"]]);
  });
});

describe("resources-wiring: the machine's own defaults (issue #154)", () => {
  test("with nothing given it reads the OS memory and the data disk, and ends an orphan with a real SIGTERM", async () => {
    const child = Bun.spawn(["sleep", "30"]);
    const pid = child.pid;
    const proc = {
      pageSize: 4096,
      ticksPerSecond: 100,
      pids: async () => [42, pid],
      stat: async (p: number) =>
        p === 1
          ? { pid: 42, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 1 }
          : { pid: p, ppid: 42, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 1 },
      cwd: async () => "/gone",
      uptimeSec: async () => 10_000,
    };
    const resources = createResources({
      dataDir: tmpdir(),
      sessions: () => [OLD_SESSION],
      terminals: () => [],
      pidOf: () => null,
      ownPid: 42,
      platform: "linux",
      proc,
    });
    const snap = await resources.snapshot();
    expect(snap.memory.totalBytes).toBeGreaterThan(0);
    expect(snap.disk?.totalBytes).toBeGreaterThan(0);
    expect(snap.loadPercent).not.toBeNull();
    await resources.endOrphan(pid, 1);
    await child.exited;
    expect(child.signalCode).toBe("SIGTERM");
  });
});

describe("resources-wiring: the machine's own page size and clock (F8)", () => {
  test("the /proc reader uses the page size and ticks the machine says, not guesses", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "fd-proc-wiring-"));
    try {
      writeFileSync(join(root, "uptime"), "10000.00 0\n");
      const add = (pid: number, ppid: number, name: string, rss: number, start: number) => {
        mkdirSync(join(root, String(pid)));
        writeFileSync(
          join(root, String(pid), "stat"),
          `${pid} (${name}) S ${ppid} 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 1 ${rss} 1`,
        );
      };
      add(42, 0, "flightdeckd", 1, 0);
      add(9, 42, "claude", 100, 1);
      symlinkSync("/gone", join(root, "9", "cwd"));
      const asked: string[] = [];
      const snap = await createResources({
        dataDir: tmpdir(),
        sessions: () => [OLD_SESSION],
        terminals: () => [],
        pidOf: () => null,
        ownPid: 42,
        platform: "linux",
        procRoot: root,
        sysconf: (name) => {
          asked.push(name);
          return name === "PAGESIZE" ? 16384 : 250;
        },
      }).snapshot();
      expect(asked.sort()).toEqual(["CLK_TCK", "PAGESIZE"]);
      // 100 pages of 16 KB, and a start of 1 tick at 250 per second in a 10 000 s uptime.
      expect(snap.orphans[0]).toMatchObject({ pid: 9, rssBytes: 100 * 16384, ageSec: 10_000 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a machine that cannot say falls back to 4 KB and 100 ticks", async () => {
    const { defaultSysconf } = await import("../src/resources/wiring.ts");
    expect(defaultSysconf(() => null, "PAGESIZE")).toBe(4096);
    expect(defaultSysconf(() => null, "CLK_TCK")).toBe(100);
    expect(defaultSysconf((name) => (name === "PAGESIZE" ? 65536 : 128), "PAGESIZE")).toBe(65536);
    expect(defaultSysconf(() => Number.NaN, "CLK_TCK")).toBe(100);
  });
});

describe("resources-wiring: getconf", () => {
  test("the machine's own page size and clock are asked, and are whole positive numbers", async () => {
    const { getconf } = await import("../src/resources/wiring.ts");
    if (process.platform === "win32") return;
    expect(getconf("PAGESIZE")).toBeGreaterThanOrEqual(4096);
    expect(getconf("CLK_TCK")).toBeGreaterThan(0);
  });
});

describe("resources-wiring: which sessions' leftovers count (N1)", () => {
  const proc = {
    pageSize: 4096,
    ticksPerSecond: 100,
    pids: async () => [42, 9],
    stat: async (p: number) =>
      p === 42
        ? { pid: 42, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 1 }
        : { pid: p, ppid: 42, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 1 },
    cwd: async () => "/gone",
    uptimeSec: async () => 10_000,
  };
  const orphans = async (status: string) =>
    (
      await createResources(
        deps({ proc, sessions: () => [{ ...OLD_SESSION, status }], terminals: () => [] }),
      ).snapshot()
    ).orphans.map((o) => o.pid);

  test("an ended or an error session's leftover is an orphan; a running, starting or waiting one is not (it is alive)", async () => {
    expect(await orphans("ended")).toEqual([9]);
    expect(await orphans("error")).toEqual([9]);
    for (const status of ["running", "starting", "awaiting_permission", "idle"]) {
      expect(await orphans(status)).toEqual([]);
    }
  });

  test("with no session of the folder at all nothing is an orphan", async () => {
    const none = await createResources(
      deps({ proc, sessions: () => [], terminals: () => [] }),
    ).snapshot();
    expect(none.orphans).toEqual([]);
  });
});
