import type { ProcStat } from "./proc-tree.ts";

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
