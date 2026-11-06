import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { ProcReader, ProcStat } from "./resources.ts";

/**
 * One line of `/proc/<pid>/stat`. The name sits in parentheses and may hold spaces and
 * parentheses itself, so it runs to the last `)`. Fields after it are numbered as in proc(5):
 * ppid is the 4th, utime the 14th, stime the 15th, starttime the 22nd and rss the 24th.
 */
export function parseStat(line: string): ProcStat | null {
  const open = line.indexOf("(");
  const close = line.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(line.slice(0, open).trim());
  const rest = line
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const field = (n: number) => Number(rest[n - 3]);
  const values = [field(4), field(14), field(15), field(22), field(24)];
  if (!Number.isInteger(pid) || pid <= 0 || values.some((v) => !Number.isFinite(v))) return null;
  const [ppid, utime, stime, startTicks, rssPages] = values as [
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    pid,
    ppid,
    name: line.slice(open + 1, close),
    cpuTicks: utime + stime,
    startTicks,
    rssPages,
  };
}

/**
 * Reads processes from `/proc` (Linux). It opens only `stat`, the `cwd` link and `uptime`: never
 * `cmdline` or `environ`, which can hold secrets, so there is no way to ask for them here.
 */
export function procfsReader(
  opts: { root?: string; pageSize?: number; ticksPerSecond?: number } = {},
): ProcReader {
  const root = opts.root ?? "/proc";
  return {
    pageSize: opts.pageSize ?? 4096,
    ticksPerSecond: opts.ticksPerSecond ?? 100,
    async pids() {
      try {
        const entries = await readdir(root);
        return entries.filter((name) => /^\d+$/.test(name)).map(Number);
      } catch {
        return [];
      }
    },
    async stat(pid) {
      try {
        return parseStat(await readFile(join(root, String(pid), "stat"), "utf8"));
      } catch {
        return null;
      }
    },
    async cwd(pid) {
      try {
        return await readlink(join(root, String(pid), "cwd"));
      } catch {
        return null;
      }
    },
    async uptimeSec() {
      try {
        return Number((await readFile(join(root, "uptime"), "utf8")).split(/\s+/)[0]) || 0;
      } catch {
        return 0;
      }
    },
  };
}
