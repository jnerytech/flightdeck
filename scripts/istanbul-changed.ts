#!/usr/bin/env bun
/**
 * `bun run scripts/istanbul-changed.ts <base> <out>` (issue #1493): a PR's changed and added test
 * files under istanbul, as the full run's istanbul shards run them. The logic is in
 * lib/istanbul-changed.ts. <out> is outside the checkout (the counters are written there).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { istanbulChanged } from "./lib/istanbul-changed.ts";

const ROOT = resolve(import.meta.dir, "..");
const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: ROOT }); // NOSONAR: git comes from the PATH of the developer or the CI runner running the script
const lines = (out: Uint8Array) => out.toString().split("\n").filter(Boolean);

const [base = "", out = ""] = process.argv.slice(2).filter((arg) => arg !== "--");
process.exit(
  await istanbulChanged(base, out, {
    root: ROOT,
    tracked: lines(git(["ls-files"]).stdout),
    changed: async (from) => {
      const diff = git(["diff", "--name-only", "--diff-filter=AMR", `${from}...HEAD`]);
      return diff.exitCode === 0 ? lines(diff.stdout) : null;
    },
    mkdir: (path) => mkdirSync(path, { recursive: true }),
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
