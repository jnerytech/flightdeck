#!/usr/bin/env bun
/**
 * The sharded whole-suite run (#296); the logic is in lib/shard-gate.ts (`runShard`, `mergeShards`),
 * this wires the real effects.
 * - `run <i>/<n> <bun|istanbul> <out>`: runs shard i of n, split as `test:shards` splits it, and
 *   writes `marker.json` next to the lcov (bun) or the function counters (istanbul). <out> is
 *   outside the checkout: the repo guard fails a test run that leaves a file in it.
 * - `merge <dir> <n> <lcov>`: reads each job's folder under <dir>, runs the merged 100% gate, and
 *   writes the merged lcov for SonarCloud. It fails closed when a shard is missing or failed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hasRuntimeCode, isCoverageSource } from "./lib/coverage-check.ts";
import { mergeShards, runShard } from "./lib/shard-gate.ts";
import type { Timings } from "./lib/test-shards.ts";

const ROOT = resolve(import.meta.dir, "..");
const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }) // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
  .stdout.toString()
  .split("\n")
  .filter(Boolean);
const readIf = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const [command, a = "", b = "", c = ""] = process.argv.slice(2).filter((arg) => arg !== "--");
if (command === "run") {
  process.exit(
    await runShard(a, b, c, {
      root: ROOT,
      tracked,
      timings: JSON.parse(readFileSync(join(ROOT, "scripts/test-timings.json"), "utf8")) as Timings,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      write,
      spawn: async (argv, env) => {
        const proc = Bun.spawn(argv, {
          cwd: ROOT,
          env: { ...process.env, ...env },
          stdout: "pipe",
          stderr: "pipe",
        }); // NOSONAR: bun comes from the PATH of the developer or the CI runner running the script
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        return { exit: await proc.exited, log: `${stdout}${stderr}` };
      },
      print: (line) => console.log(line),
    }),
  );
} else if (command === "merge") {
  const sources = tracked
    .filter(isCoverageSource)
    .filter((path) =>
      hasRuntimeCode(readFileSync(join(ROOT, path), "utf8"), path.endsWith(".tsx") ? "tsx" : "ts"),
    );
  process.exit(
    mergeShards(a, Number(b), c, {
      folders: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      read: readIf,
      write,
      tracked,
      sources,
      print: (line) => console.log(line),
      error: (line) => console.error(line),
    }),
  );
} else {
  console.error(
    "usage: bun run scripts/shard-gate.ts run <i>/<n> <bun|istanbul> <out> | merge <dir> <n> <lcov>",
  );
  process.exit(2);
}
