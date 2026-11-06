import { describe, expect, test } from "bun:test";
import {
  type ProcReader,
  type ProcStat,
  type ResourceSession,
  Resources,
  type ResourceTerminal,
} from "../src/resources/resources.ts";

const MB = 1024 * 1024;
const PAGE = 4096;
const HZ = 100;
const DAEMON = 100;

interface Proc extends ProcStat {
  cwd?: string;
}

/** A fake /proc: a list of processes, never the machine's. */
function fakeProc(procs: Proc[], reads: string[] = []): ProcReader {
  return {
    pageSize: PAGE,
    ticksPerSecond: HZ,
    pids: async () => procs.map((p) => p.pid),
    stat: async (pid) => {
      reads.push(`stat:${pid}`);
      const found = procs.find((p) => p.pid === pid);
      return found ? { ...found } : null;
    },
    cwd: async (pid) => procs.find((p) => p.pid === pid)?.cwd ?? null,
    uptimeSec: async () => 10_000,
  };
}
const proc = (
  pid: number,
  ppid: number,
  name: string,
  rssMb: number,
  extra: Partial<Proc> = {},
): Proc => ({
  pid,
  ppid,
  name,
  cpuTicks: 0,
  startTicks: pid * 100,
  rssPages: (rssMb * MB) / PAGE,
  ...extra,
});

const session = (id: string, cwd: string, createdAt: string, active = true): ResourceSession => ({
  id,
  name: id,
  cwd,
  createdAt,
  updatedAt: createdAt,
  active,
});

/** A session that is over and was alive for the whole of today (and then some): its folder's leftovers are its. */
const ended = (cwd: string): ResourceSession => ({
  id: `old-${cwd}`,
  name: null,
  cwd,
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2100-01-01T00:00:00Z",
  active: false,
});

function make(
  procs: Proc[],
  options: {
    sessions?: ResourceSession[];
    terminals?: ResourceTerminal[];
    killed?: number[];
    proc?: ProcReader | null;
    clock?: { now: number };
  } = {},
) {
  const clock = options.clock ?? { now: Date.parse("2026-11-05T12:00:00Z") };
  return new Resources({
    proc: options.proc === undefined ? fakeProc(procs) : options.proc,
    ownPid: DAEMON,
    sessions: () => options.sessions ?? [],
    terminals: () => options.terminals ?? [],
    memory: () => ({ totalBytes: 8000 * MB, freeBytes: 3000 * MB }),
    disk: async () => ({ totalBytes: 100_000 * MB, freeBytes: 40_000 * MB }),
    loadPercent: () => 35,
    kill: (pid) => void options.killed?.push(pid),
    now: () => clock.now,
  });
}

describe("resources: what the host's work costs it (issue #154)", () => {
  test("the host's memory, disk and load come as they are", async () => {
    const snap = await make([]).snapshot();
    expect(snap.memory).toEqual({ totalBytes: 8000 * MB, freeBytes: 3000 * MB });
    expect(snap.disk).toEqual({ totalBytes: 100_000 * MB, freeBytes: 40_000 * MB });
    expect(snap.loadPercent).toBe(35);
    expect(snap.measured).toBe(true);
    expect(snap.reason).toBeNull();
    expect(snap.at).toBe("2026-11-05T12:00:00.000Z");
  });

  test("a session is its claude process and everything under it, matched by folder", async () => {
    const snap = await make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        proc(200, DAEMON, "claude", 300, { cwd: "/work/api" }),
        proc(201, 200, "bash", 20),
        proc(202, 201, "bun", 80),
        proc(300, DAEMON, "claude", 150, { cwd: "/work/web" }),
      ],
      {
        sessions: [
          session("s-api", "/work/api", "2026-11-05T10:00:00Z"),
          session("s-web", "/work/web", "2026-11-05T10:05:00Z"),
        ],
      },
    ).snapshot();
    const api = snap.rows.find((r) => r.id === "s-api");
    expect(api).toMatchObject({ kind: "session", processes: 3, cwd: "/work/api" });
    expect(api?.rssBytes).toBe(400 * MB);
    expect(api?.names).toEqual(["claude", "bash", "bun"]);
    expect(snap.rows.find((r) => r.id === "s-web")?.rssBytes).toBe(150 * MB);
    expect(snap.orphans).toEqual([]);
  });

  test("two sessions in one folder take the two processes in the order they started", async () => {
    const snap = await make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        proc(210, DAEMON, "claude", 100, { cwd: "/work/api", startTicks: 1000 }),
        proc(211, DAEMON, "claude", 200, { cwd: "/work/api", startTicks: 2000 }),
      ],
      {
        sessions: [
          session("second", "/work/api", "2026-11-05T11:00:00Z"),
          session("first", "/work/api", "2026-11-05T10:00:00Z"),
        ],
      },
    ).snapshot();
    expect(snap.rows.find((r) => r.id === "first")?.rssBytes).toBe(100 * MB);
    expect(snap.rows.find((r) => r.id === "second")?.rssBytes).toBe(200 * MB);
  });

  test("a terminal is its shell by pid and everything under it", async () => {
    const snap = await make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        proc(400, DAEMON, "bash", 10),
        proc(401, 400, "bun", 500),
      ],
      { terminals: [{ id: "t1", name: "bash", cwd: "/work/api", pid: 400 }] },
    ).snapshot();
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]).toMatchObject({ kind: "terminal", id: "t1", processes: 2 });
    expect(snap.rows[0]?.rssBytes).toBe(510 * MB);
    expect(snap.orphans).toEqual([]);
  });

  test("CPU is the share of a core since the last reading: unknown the first time", async () => {
    const clock = { now: Date.parse("2026-11-05T12:00:00Z") };
    const procs = [
      proc(DAEMON, 1, "flightdeckd", 50),
      proc(200, DAEMON, "claude", 100, { cwd: "/work/api", cpuTicks: 1000 }),
    ];
    const resources = make(procs, {
      sessions: [session("s", "/work/api", "2026-11-05T10:00:00Z")],
      clock,
    });
    expect((await resources.snapshot()).rows[0]?.cpuPercent).toBeNull();
    // 5 s later the process has used 250 more ticks (2.5 s of CPU): 50 % of a core.
    clock.now += 5000;
    (procs[1] as Proc).cpuTicks = 1250;
    expect((await resources.snapshot()).rows[0]?.cpuPercent).toBe(50);
  });

  test("a claude process no session owns is an orphan, once it is old enough to be one", async () => {
    const procs = [
      proc(DAEMON, 1, "flightdeckd", 50),
      // Started 2 h ago (uptime 10 000 s, 7200 s = 720 000 ticks before now).
      proc(500, DAEMON, "claude", 120, { cwd: "/gone", startTicks: 1_000_000 - 720_000 }),
      // Started 10 s ago: probably a short query that is about to end.
      proc(501, DAEMON, "claude", 90, { cwd: "/new", startTicks: 1_000_000 - 1000 }),
    ];
    const snap = await make(procs, { sessions: [ended("/gone"), ended("/new")] }).snapshot();
    expect(snap.orphans).toEqual([
      {
        pid: 500,
        name: "claude",
        rssBytes: 120 * MB,
        ageSec: 7200,
        startTicks: 1_000_000 - 720_000,
      },
    ]);
  });

  test("only the daemon's own processes are ever listed", async () => {
    const snap = await make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        // Not a descendant of the daemon: a claude the person runs in their own terminal.
        proc(600, 1, "claude", 700, { cwd: "/home", startTicks: 1 }),
      ],
      { sessions: [] },
    ).snapshot();
    expect(snap.orphans).toEqual([]);
    expect(snap.rows).toEqual([]);
  });

  test("ending an orphan signals that pid after checking again that it is one", async () => {
    const killed: number[] = [];
    const resources = make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        proc(500, DAEMON, "claude", 120, { cwd: "/gone", startTicks: 1 }),
      ],
      { killed, sessions: [ended("/gone")] },
    );
    await resources.endOrphan(500, 1);
    expect(killed).toEqual([500]);
  });

  test("a process that is not an orphan cannot be ended: a session's, a terminal's, a stranger's, the daemon itself", async () => {
    const killed: number[] = [];
    const resources = make(
      [
        proc(DAEMON, 1, "flightdeckd", 50),
        proc(200, DAEMON, "claude", 100, { cwd: "/work/api", startTicks: 1 }),
        proc(400, DAEMON, "bash", 10),
        proc(600, 1, "claude", 700, { cwd: "/home", startTicks: 1 }),
      ],
      {
        killed,
        sessions: [session("s", "/work/api", "2026-11-05T10:00:00Z")],
        terminals: [{ id: "t", name: "bash", cwd: "/", pid: 400 }],
      },
    );
    for (const pid of [200, 400, 600, DAEMON, 9999]) {
      await expect(resources.endOrphan(pid, 1)).rejects.toMatchObject({ reason: "not_orphan" });
    }
    expect(killed).toEqual([]);
  });

  test("no command line, argument or environment is ever read", async () => {
    const reads: string[] = [];
    const procs = [
      proc(DAEMON, 1, "flightdeckd", 50),
      proc(200, DAEMON, "claude", 100, { cwd: "/work/api" }),
    ];
    const snap = await make(procs, {
      proc: fakeProc(procs, reads),
      sessions: [session("s", "/work/api", "2026-11-05T10:00:00Z")],
    }).snapshot();
    expect(JSON.stringify(snap)).not.toMatch(/--|SECRET|token/i);
    // The reader has no method that returns arguments or the environment.
    expect(Object.keys(fakeProc([])).sort()).toEqual([
      "cwd",
      "pageSize",
      "pids",
      "stat",
      "ticksPerSecond",
      "uptimeSec",
    ]);
  });

  test("where there is no /proc the host numbers still come, the processes are not measured", async () => {
    const snap = await make([], { proc: null }).snapshot();
    expect(snap.measured).toBe(false);
    expect(snap.reason).toBe("platform");
    expect(snap.rows).toEqual([]);
    expect(snap.orphans).toEqual([]);
    expect(snap.memory.totalBytes).toBe(8000 * MB);
    await expect(make([], { proc: null }).endOrphan(500, 1)).rejects.toMatchObject({
      reason: "not_orphan",
    });
  });
});
