import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
/** Uptime 10 000 s: a process with startTicks 1 is almost 3 h old; one at 999 000 ticks is 10 s old. */
const OLD = 1;
const YOUNG = 999_000;

interface Proc extends ProcStat {
  cwd?: string | null;
}
const proc = (pid: number, ppid: number, name: string, extra: Partial<Proc> = {}): Proc => ({
  pid,
  ppid,
  name,
  cpuTicks: 0,
  startTicks: OLD,
  rssPages: (10 * MB) / PAGE,
  ...extra,
});

/** A fake /proc over a mutable list; `onStat` sees every call. */
function reader(
  procs: Proc[],
  hooks: { onPids?: () => void; onStat?: (pid: number) => void } = {},
): ProcReader {
  return {
    pageSize: PAGE,
    ticksPerSecond: HZ,
    pids: async () => {
      hooks.onPids?.();
      return procs.map((p) => p.pid);
    },
    stat: async (pid) => {
      hooks.onStat?.(pid);
      const found = procs.find((p) => p.pid === pid);
      return found ? { ...found } : null;
    },
    cwd: async (pid) => {
      const found = procs.find((p) => p.pid === pid);
      return found && found.cwd !== undefined ? found.cwd : null;
    },
    uptimeSec: async () => 10_000,
  };
}

const session = (
  id: string,
  cwd: string,
  active = true,
  createdAt = "2026-11-05T10:00:00Z",
): ResourceSession => ({
  id,
  name: id,
  cwd,
  createdAt,
  active,
});

function make(
  procs: Proc[],
  options: {
    sessions?: ResourceSession[];
    terminals?: ResourceTerminal[];
    killed?: number[];
    kill?: (pid: number) => void;
    clock?: { now: number };
    reader?: ProcReader;
    ownPid?: number;
  } = {},
) {
  const clock = options.clock ?? { now: Date.parse("2026-11-05T12:00:00Z") };
  return new Resources({
    proc: options.reader ?? reader(procs),
    ownPid: options.ownPid ?? DAEMON,
    sessions: () => options.sessions ?? [],
    terminals: () => options.terminals ?? [],
    memory: () => ({ totalBytes: 8000 * MB, freeBytes: 3000 * MB }),
    disk: async () => null,
    loadPercent: () => null,
    kill: options.kill ?? ((pid) => void options.killed?.push(pid)),
    now: () => clock.now,
  });
}

const orphansOf = async (r: Resources) => (await r.snapshot()).orphans.map((o) => o.pid);

describe("resources-security: what is never called an orphan (F1, F2, F6)", () => {
  test("F1: a claude whose folder cannot be read is left out: nothing says it is nobody's", async () => {
    const r = make([proc(DAEMON, 1, "flightdeckd"), proc(200, DAEMON, "claude", { cwd: null })]);
    expect(await orphansOf(r)).toEqual([]);
    await expect(r.endOrphan(200, OLD)).rejects.toMatchObject({ reason: "not_orphan" });
  });

  test("F2: a claude in a folder where an active session lives is that session's, however many there are", async () => {
    const r = make(
      [
        proc(DAEMON, 1, "flightdeckd"),
        // A leftover older than the live one, in the same folder: either could be the session's.
        proc(200, DAEMON, "claude", { cwd: "/work/api", startTicks: 100 }),
        proc(201, DAEMON, "claude", { cwd: "/work/api", startTicks: 5000 }),
      ],
      { sessions: [session("s", "/work/api")] },
    );
    expect(await orphansOf(r)).toEqual([]);
  });

  test("F2: a folder reading '(deleted)' is the same folder: the live session keeps its process", async () => {
    const r = make(
      [proc(DAEMON, 1, "flightdeckd"), proc(200, DAEMON, "claude", { cwd: "/work/api (deleted)" })],
      { sessions: [session("s", "/work/api")] },
    );
    expect(await orphansOf(r)).toEqual([]);
  });

  test("an ended session's process that is still alive is an orphan: that is what the list is for", async () => {
    const r = make(
      [proc(DAEMON, 1, "flightdeckd"), proc(200, DAEMON, "claude", { cwd: "/work/api" })],
      {
        sessions: [session("s", "/work/api", false)],
      },
    );
    expect(await orphansOf(r)).toEqual([200]);
  });

  test("F6: only claude can be an orphan: an old unowned git, bun or plugin helper is not", async () => {
    const r = make([
      proc(DAEMON, 1, "flightdeckd"),
      proc(200, DAEMON, "git", { cwd: "/x" }),
      proc(201, DAEMON, "bun", { cwd: "/x" }),
      proc(202, DAEMON, "claude", { cwd: "/x" }),
    ]);
    expect(await orphansOf(r)).toEqual([202]);
  });

  test("F6: a terminal's root is never an orphan, even when the program in it is claude", async () => {
    const r = make([proc(DAEMON, 1, "flightdeckd"), proc(300, DAEMON, "claude", { cwd: "/x" })], {
      terminals: [{ id: "t", name: "claude", cwd: "/x", pid: 300 }],
    });
    expect(await orphansOf(r)).toEqual([]);
    await expect(r.endOrphan(300, OLD)).rejects.toMatchObject({ reason: "not_orphan" });
  });

  test("F7: a daemon that is pid 1 (a container) lists no orphans: every stray would be its child", async () => {
    const r = make([proc(1, 0, "flightdeckd"), proc(200, 1, "claude", { cwd: "/x" })], {
      ownPid: 1,
    });
    expect(await orphansOf(r)).toEqual([]);
  });
});

describe("resources-security: ending carries the process, not only the pid (F3)", () => {
  const base = () => [
    proc(DAEMON, 1, "flightdeckd"),
    proc(500, DAEMON, "claude", { cwd: "/gone", startTicks: 4242 }),
  ];

  test("the orphan names its start, and ending needs the same one", async () => {
    const killed: number[] = [];
    const r = make(base(), { killed });
    expect((await r.snapshot()).orphans[0]).toMatchObject({ pid: 500, startTicks: 4242 });
    await expect(r.endOrphan(500, 4241)).rejects.toMatchObject({ reason: "not_orphan" });
    expect(killed).toEqual([]);
    await r.endOrphan(500, 4242);
    expect(killed).toEqual([500]);
  });

  test("the process is looked at again right before the signal: one that was replaced meanwhile is not touched", async () => {
    const procs = base();
    let stats = 0;
    const killed: number[] = [];
    const r = make(procs, {
      killed,
      reader: reader(procs, {
        onStat: (pid) => {
          if (pid !== 500) return;
          stats++;
          // After the snapshot has read it (the first time), the pid is another process.
          if (stats === 2) Object.assign(procs[1] as Proc, { startTicks: 999_999, name: "claude" });
        },
      }),
    });
    await expect(r.endOrphan(500, 4242)).rejects.toMatchObject({ reason: "not_orphan" });
    expect(killed).toEqual([]);
  });

  test("a process that is gone between the look and the signal counts as ended; another failure is not hidden", async () => {
    const gone = make(base(), {
      kill: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
    });
    await gone.endOrphan(500, 4242);
    const denied = make(base(), {
      kill: () => {
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      },
    });
    await expect(denied.endOrphan(500, 4242)).rejects.toMatchObject({ code: "EPERM" });
  });
});

describe("resources-security: a bounded read (F4)", () => {
  test("two snapshots asked together share one read of the machine", async () => {
    let reads = 0;
    const procs = [proc(DAEMON, 1, "flightdeckd")];
    const r = make(procs, { reader: reader(procs, { onPids: () => void reads++ }) });
    const [a, b] = await Promise.all([r.snapshot(), r.snapshot()]);
    expect(reads).toBe(1);
    expect(a).toBe(b);
  });

  test("a snapshot is kept for a second or two, then read again", async () => {
    let reads = 0;
    const procs = [proc(DAEMON, 1, "flightdeckd")];
    const clock = { now: Date.parse("2026-11-05T12:00:00Z") };
    const r = make(procs, { clock, reader: reader(procs, { onPids: () => void reads++ }) });
    await r.snapshot();
    clock.now += 1000;
    await r.snapshot();
    expect(reads).toBe(1);
    clock.now += 1500;
    await r.snapshot();
    expect(reads).toBe(2);
  });

  test("the /proc is read in batches: never more than 32 stats in flight", async () => {
    const procs = [
      proc(DAEMON, 1, "flightdeckd"),
      ...Array.from({ length: 200 }, (_, i) => proc(1000 + i, 1, "idle")),
    ];
    let inFlight = 0;
    let most = 0;
    const slow: ProcReader = {
      ...reader(procs),
      stat: async (pid) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await Bun.sleep(1);
        inFlight--;
        return { ...(procs.find((p) => p.pid === pid) as Proc) };
      },
    };
    await make(procs, { reader: slow }).snapshot();
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(32);
  });

  test("a loop in the parents (a pid reused mid-scan) ends instead of overflowing the stack", async () => {
    // The daemon's own parent reads as its child: a cycle that reaches the daemon again.
    const r = make([proc(DAEMON, 201, "flightdeckd"), proc(201, DAEMON, "claude", { cwd: "/x" })], {
      sessions: [session("s", "/x")],
    });
    const snap = await r.snapshot();
    expect(snap.rows.find((row) => row.id === "s")?.processes).toBeLessThanOrEqual(2);
  });

  test("ending an orphan reads on its own: the CPU window of the panel is not shortened", async () => {
    const clock = { now: Date.parse("2026-11-05T12:00:00Z") };
    const procs = [
      proc(DAEMON, 1, "flightdeckd"),
      proc(200, DAEMON, "claude", { cwd: "/work/api", cpuTicks: 1000 }),
      proc(500, DAEMON, "claude", { cwd: "/gone", startTicks: 4242 }),
    ];
    const r = make(procs, { sessions: [session("s", "/work/api")], clock, killed: [] });
    await r.snapshot();
    // 5 s later something ends an orphan; it must not become the new "previous reading".
    clock.now += 5000;
    (procs[1] as Proc).cpuTicks = 1400;
    await r.endOrphan(500, 4242);
    clock.now += 5000;
    (procs[1] as Proc).cpuTicks = 1500;
    // 500 ticks in 10 s is 50 %; against the endOrphan's reading it would read 20 %.
    expect((await r.snapshot()).rows[0]?.cpuPercent).toBe(50);
  });

  test("a name from a process is cleaned of control characters and cut", async () => {
    const r = make(
      [
        proc(DAEMON, 1, "flightdeckd"),
        proc(200, DAEMON, "claude", { cwd: "/x" }),
        proc(201, 200, "bad\u001b[31m-red\u0007-and-a-very-long-name-that-goes-on"),
      ],
      { sessions: [session("s", "/x")] },
    );
    const names = (await r.snapshot()).rows[0]?.names ?? [];
    expect(names.length).toBe(2);
    expect(
      [...names.join("")].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127),
    ).toBe(false);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(32);
  });
});

describe("resources-security: the request (F5, F6)", () => {
  test("F5: ending an orphan asks for the same transport as the other host-changing commands", () => {
    const source = readFileSync(join(import.meta.dir, "../src/server.ts"), "utf8");
    expect(source).toMatch(
      /case "resources\.endOrphan":\s*\n\s*requireVaultTransport\(ws\.data\.origin, "resources\.endOrphan"/,
    );
  });
});
