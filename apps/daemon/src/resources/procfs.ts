import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { parseStat } from "./domain/proc-stat.ts";
import type { ProcReader } from "./resources.ts";

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
