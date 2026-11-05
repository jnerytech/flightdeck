#!/usr/bin/env bun
/**
 * `bun run handoff:check`: typecheck, lint, tdd:audit and test:related --fast, in order, then one
 * stamp line to paste into the hand-off message, also kept in the worktree's git folder
 * (scripts/lib/handoff.ts). `--verify` is for the receiver: it checks the kept stamp against HEAD.
 * Never run it under the slot: test:related takes the slot by itself when it needs it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runHandoff, stampProblem } from "./lib/handoff.ts";

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? ""; // NOSONAR: git from the PATH of the developer running the script
const root = git(["rev-parse", "--show-toplevel"]) || resolve(import.meta.dir, "..");
const stampFile = resolve(root, git(["rev-parse", "--git-path", "flightdeck-handoff"]));
const head = git(["rev-parse", "HEAD"]);

if (process.argv.includes("--verify")) {
  let stamp: string | null = null;
  try {
    stamp = readFileSync(stampFile, "utf8");
  } catch {
    // No stamp yet.
  }
  const problem = stampProblem(stamp, head);
  console.log(problem ? `handoff:check: ${problem}` : `handoff:check: OK for ${head}`);
  process.exit(problem ? 1 : 0);
}

const result = await runHandoff({
  run: async (command) => {
    const [program = "bun", ...rest] = command;
    console.error(`\n$ ${command.join(" ")}`);
    return await Bun.spawn([program === "bun" ? process.execPath : program, ...rest], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    }).exited;
  },
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  head,
  now: new Date().toISOString(),
});
writeFileSync(stampFile, `${result.stamp}\n`);
console.log(`\n${result.stamp}`);
process.exit(result.code);
