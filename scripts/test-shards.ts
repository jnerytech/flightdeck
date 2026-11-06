#!/usr/bin/env bun
/**
 * `bun run test:shards -- plan|run <i>/<n>` and `record <junit.xml>...` (issue #292): the Windows
 * unit-test shards, split by the seconds each test file took (`scripts/test-timings.json`). The
 * logic is in lib/test-shards.ts; this wires the real effects.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { shards, type Timings } from "./lib/test-shards.ts";

const ROOT = resolve(import.meta.dir, "..");
const TIMINGS = resolve(import.meta.dir, "test-timings.json");

process.exit(
  await shards(
    process.argv.slice(2).filter((a) => a !== "--"),
    {
      git: (args) => {
        const run = Bun.spawnSync(["git", ...args], { cwd: ROOT }); // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
        return run.exitCode === 0 ? run.stdout.toString() : null;
      },
      readTimings: () =>
        existsSync(TIMINGS) ? (JSON.parse(readFileSync(TIMINGS, "utf8")) as Timings) : {},
      writeTimings: (timings) => writeFileSync(TIMINGS, `${JSON.stringify(timings, null, 2)}\n`),
      readFile: (path) => readFileSync(resolve(path), "utf8"),
      bun: async (args) => {
        const run = Bun.spawn(["bun", ...args], {
          cwd: ROOT,
          stdio: ["inherit", "inherit", "inherit"],
        }); // NOSONAR: bun comes from the PATH of the developer or the CI runner running the script
        return await run.exited;
      },
      log: (line) => console.log(line),
      tiers: () => ({}),
    },
  ),
);
