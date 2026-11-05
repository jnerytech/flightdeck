import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStat, procfsReader } from "../src/resources/procfs.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory shaped like /proc, in a temp folder: the machine's own is never read. */
function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), "fd-proc-"));
  dirs.push(root);
  writeFileSync(join(root, "uptime"), "12345.67 9999.00\n");
  const add = (pid: number, stat: string, cwd?: string) => {
    mkdirSync(join(root, String(pid)));
    writeFileSync(join(root, String(pid), "stat"), stat);
    // Traps: a reader that opens these would leak secrets. They are unreadable text here.
    writeFileSync(join(root, String(pid), "cmdline"), "claude\0--api-key=SECRET\0");
    writeFileSync(join(root, String(pid), "environ"), "TOKEN=SECRET\0");
    if (cwd) symlinkSync(cwd, join(root, String(pid), "cwd"));
  };
  return { root, add };
}

// pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime
// cutime cstime priority nice threads itrealvalue starttime vsize rss
const stat = (
  pid: number,
  comm: string,
  ppid: number,
  utime: number,
  stime: number,
  start: number,
  rss: number,
) =>
  `${pid} (${comm}) S ${ppid} 1 1 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 1 0 ${start} 123456789 ${rss} 18446744073709551615`;

describe("resources-procfs: the Linux /proc reader (issue #154)", () => {
  test("a stat line gives the name, parent, CPU ticks, start and resident pages", () => {
    expect(parseStat(stat(42, "claude", 7, 300, 200, 9000, 5120))).toEqual({
      pid: 42,
      ppid: 7,
      name: "claude",
      cpuTicks: 500,
      startTicks: 9000,
      rssPages: 5120,
    });
  });

  test("a name with spaces and parentheses is read up to the last closing one", () => {
    expect(parseStat(stat(9, "Web Content (x)", 1, 1, 2, 3, 4))?.name).toBe("Web Content (x)");
  });

  test("a line that is not a stat line is nothing", () => {
    expect(parseStat("")).toBeNull();
    expect(parseStat("garbage")).toBeNull();
  });

  test("the reader lists the numeric entries, reads a process and its folder, and the uptime", async () => {
    const { root, add } = fakeRoot();
    add(10, stat(10, "bash", 1, 1, 1, 100, 10), "/work/api");
    add(11, stat(11, "claude", 10, 5, 5, 200, 50));
    mkdirSync(join(root, "self"));
    const reader = procfsReader({ root, pageSize: 4096, ticksPerSecond: 100 });
    expect((await reader.pids()).sort()).toEqual([10, 11]);
    expect(await reader.stat(11)).toMatchObject({ name: "claude", ppid: 10, cpuTicks: 10 });
    expect(await reader.cwd(10)).toBe("/work/api");
    expect(await reader.cwd(11)).toBeNull();
    expect(await reader.stat(999)).toBeNull();
    expect(await reader.uptimeSec()).toBeCloseTo(12345.67);
    expect([reader.pageSize, reader.ticksPerSecond]).toEqual([4096, 100]);
  });

  test("the reader has nothing to read a command line or an environment with", () => {
    const reader = procfsReader({ root: "/nonexistent", pageSize: 4096, ticksPerSecond: 100 });
    expect(Object.keys(reader).sort()).toEqual([
      "cwd",
      "pageSize",
      "pids",
      "stat",
      "ticksPerSecond",
      "uptimeSec",
    ]);
  });

  test("a missing /proc is an empty list, not a crash", async () => {
    const reader = procfsReader({ root: "/nonexistent", pageSize: 4096, ticksPerSecond: 100 });
    expect(await reader.pids()).toEqual([]);
    expect(await reader.uptimeSec()).toBe(0);
  });
});

describe("resources-procfs: nothing that holds arguments or secrets is opened (F6)", () => {
  test("a process with a readable command line and environment shows none of it in a snapshot", async () => {
    const { root, add } = fakeRoot();
    add(100, stat(100, "flightdeckd", 1, 0, 0, 0, 10));
    add(200, stat(200, "claude", 100, 5, 5, 1, 50), "/work/x");
    add(201, stat(201, "bash", 200, 1, 1, 2, 5));
    const { Resources } = await import("../src/resources/resources.ts");
    const resources = new Resources({
      proc: procfsReader({ root, pageSize: 4096, ticksPerSecond: 100 }),
      ownPid: 100,
      sessions: () => [
        {
          id: "s",
          name: "s",
          cwd: "/work/x",
          createdAt: "2026-11-05T10:00:00Z",
          updatedAt: "2026-11-05T10:00:00Z",
          active: true,
        },
      ],
      terminals: () => [],
      memory: () => ({ totalBytes: 1, freeBytes: 1 }),
      disk: async () => null,
      loadPercent: () => null,
      kill: () => {},
    });
    const text = JSON.stringify(await resources.snapshot());
    expect(text).toContain("claude");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("api-key");
    expect(text).not.toContain("TOKEN");
  });

  test("with the command line and environment unreadable (folders), stat and the folder still work", async () => {
    const { root, add } = fakeRoot();
    add(300, stat(300, "claude", 1, 1, 1, 1, 7), "/work/y");
    for (const trap of ["cmdline", "environ"]) {
      rmSync(join(root, "300", trap));
      mkdirSync(join(root, "300", trap));
    }
    const reader = procfsReader({ root, pageSize: 4096, ticksPerSecond: 100 });
    expect(await reader.stat(300)).toMatchObject({ name: "claude", rssPages: 7 });
    expect(await reader.cwd(300)).toBe("/work/y");
  });

  test("a stat line with no usable pid is nothing", () => {
    expect(parseStat(stat(0, "x", 1, 1, 1, 1, 1))).toBeNull();
    expect(parseStat(" (x) S 1 1 1 0 -1 0 0 0 0 0 1 1 0 0 20 0 1 0 1 1 1 1")).toBeNull();
  });
});
