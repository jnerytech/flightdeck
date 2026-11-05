import { describe, expect, test } from "bun:test";
import {
  type ProcReader,
  type ProcStat,
  type ResourceSession,
  Resources,
} from "../src/resources/resources.ts";

const PAGE = 4096;
const HZ = 100;
const DAEMON = 100;
/** Now is noon; uptime 10 000 s; a process at 100 000 ticks started 1000 s after the boot: 09:30:00. */
const NOW = Date.parse("2026-11-05T12:00:00Z");
const START_TICKS = 100_000;

interface Proc extends ProcStat {
  cwd: string;
}
const claude = (pid: number, cwd: string): Proc => ({
  pid,
  ppid: DAEMON,
  name: "claude",
  cpuTicks: 0,
  startTicks: START_TICKS,
  rssPages: 100,
  cwd,
});
const daemon: Proc = {
  pid: DAEMON,
  ppid: 1,
  name: "flightdeckd",
  cpuTicks: 0,
  startTicks: 0,
  rssPages: 10,
  cwd: "/daemon",
};

const reader = (procs: Proc[]): ProcReader => ({
  pageSize: PAGE,
  ticksPerSecond: HZ,
  pids: async () => procs.map((p) => p.pid),
  stat: async (pid) => {
    const found = procs.find((p) => p.pid === pid);
    return found ? { ...found } : null;
  },
  cwd: async (pid) => procs.find((p) => p.pid === pid)?.cwd ?? null,
  uptimeSec: async () => 10_000,
});

const session = (
  cwd: string,
  createdAt: string,
  updatedAt: string,
  active = false,
): ResourceSession => ({
  id: `s-${cwd}-${createdAt}`,
  name: null,
  cwd,
  createdAt,
  updatedAt,
  active,
});

function make(procs: Proc[], sessions: ResourceSession[], killed: number[] = []) {
  return new Resources({
    proc: reader([daemon, ...procs]),
    ownPid: DAEMON,
    sessions: () => sessions,
    terminals: () => [],
    memory: () => ({ totalBytes: 1, freeBytes: 1 }),
    disk: async () => null,
    loadPercent: () => null,
    kill: (pid) => void killed.push(pid),
    now: () => NOW,
  });
}
const orphansOf = async (r: Resources) => (await r.snapshot()).orphans.map((o) => o.pid);

describe("resources-orphan: only what was a session's can be called a leftover (N1, N2)", () => {
  test("a claude the daemon started for something else (a plugin, the account query, an action) is never listed or ended", async () => {
    const killed: number[] = [];
    // Old enough, readable folder, no session in it: exactly what a plugin install or an account query looks like.
    const r = make([claude(500, "/daemon")], [], killed);
    expect(await orphansOf(r)).toEqual([]);
    await expect(r.endOrphan(500, START_TICKS)).rejects.toMatchObject({ reason: "not_orphan" });
    expect(killed).toEqual([]);
  });

  test("a leftover of an ended session, started while that session lived, is an orphan and can be ended", async () => {
    const killed: number[] = [];
    const r = make(
      [claude(500, "/work/api")],
      [session("/work/api", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")],
      killed,
    );
    expect(await orphansOf(r)).toEqual([500]);
    await r.endOrphan(500, START_TICKS);
    expect(killed).toEqual([500]);
  });

  test("an error session counts the same: it is over", async () => {
    const r = make(
      [claude(500, "/work/api")],
      [session("/work/api", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")],
    );
    expect(await orphansOf(r)).toEqual([500]);
  });

  test("a claude that started after the session ended (a plugin install in the same folder) is not its leftover", async () => {
    const killed: number[] = [];
    const r = make(
      [claude(500, "/work/api")],
      [session("/work/api", "2026-11-05T08:00:00Z", "2026-11-05T09:00:00Z")],
      killed,
    );
    expect(await orphansOf(r)).toEqual([]);
    await expect(r.endOrphan(500, START_TICKS)).rejects.toMatchObject({ reason: "not_orphan" });
    expect(killed).toEqual([]);
  });

  test("a claude that started before the session was created is not its leftover either", async () => {
    const r = make(
      [claude(500, "/work/api")],
      [session("/work/api", "2026-11-05T09:40:00Z", "2026-11-05T10:00:00Z")],
    );
    expect(await orphansOf(r)).toEqual([]);
  });

  test("the edges give 10 seconds of slack, no more", async () => {
    // The process started at 09:30:00.
    const at = async (created: string, updated: string) =>
      orphansOf(make([claude(500, "/work/api")], [session("/work/api", created, updated)]));
    expect(await at("2026-11-05T09:00:00Z", "2026-11-05T09:29:50Z")).toEqual([500]);
    expect(await at("2026-11-05T09:00:00Z", "2026-11-05T09:29:49Z")).toEqual([]);
    expect(await at("2026-11-05T09:30:10Z", "2026-11-05T10:00:00Z")).toEqual([500]);
    expect(await at("2026-11-05T09:30:11Z", "2026-11-05T10:00:00Z")).toEqual([]);
  });

  test("an ended session in another folder says nothing about this one", async () => {
    const r = make(
      [claude(500, "/work/web")],
      [session("/work/api", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")],
    );
    expect(await orphansOf(r)).toEqual([]);
  });

  test("a live session whose folder was moved or renamed under it keeps its process: it matches no ended session", async () => {
    const killed: number[] = [];
    // The session says /work/api; the process's folder now reads /work/api-v2.
    const r = make(
      [claude(500, "/work/api-v2")],
      [session("/work/api", "2026-11-05T09:00:00Z", "2026-11-05T12:00:00Z", true)],
      killed,
    );
    expect(await orphansOf(r)).toEqual([]);
    await expect(r.endOrphan(500, START_TICKS)).rejects.toMatchObject({ reason: "not_orphan" });
    expect(killed).toEqual([]);
  });

  test("a live session in the folder still shields a leftover there, whatever ended sessions say", async () => {
    const r = make(
      [claude(500, "/work/api")],
      [
        session("/work/api", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"),
        session("/work/api", "2026-11-05T11:00:00Z", "2026-11-05T12:00:00Z", true),
      ],
    );
    expect(await orphansOf(r)).toEqual([]);
  });
});
