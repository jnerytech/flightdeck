import { describe, expect, test } from "bun:test";
import { createResources } from "../src/resources/wiring.ts";

const MB = 1024 * 1024;

const deps = (over: Partial<Parameters<typeof createResources>[0]> = {}) => ({
  platform: "linux" as NodeJS.Platform,
  ownPid: 1,
  dataDir: "/data",
  sessions: () => [
    { id: "a", name: "A", cwd: "/w", status: "running", createdAt: "2026-11-05T10:00:00Z" },
    { id: "b", name: null, cwd: "/w", status: "ended", createdAt: "2026-11-05T10:00:00Z" },
    { id: "c", name: "C", cwd: "/w", status: "error", createdAt: "2026-11-05T10:00:00Z" },
    {
      id: "d",
      name: "D",
      cwd: "/w",
      status: "awaiting_permission",
      createdAt: "2026-11-05T10:00:00Z",
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
      pids: async () => [1, 9],
      stat: async (pid: number) =>
        pid === 1
          ? { pid: 1, ppid: 0, name: "flightdeckd", cpuTicks: 0, startTicks: 0, rssPages: 1 }
          : { pid: 9, ppid: 1, name: "claude", cpuTicks: 0, startTicks: 1, rssPages: 1 },
      cwd: async () => "/gone",
      uptimeSec: async () => 10_000,
    };
    await createResources(
      deps({
        proc,
        sessions: () => [],
        terminals: () => [],
        kill: (pid, sig) => void signals.push([pid, sig]),
      }),
    ).endOrphan(9);
    expect(signals).toEqual([[9, "SIGTERM"]]);
  });
});
