#!/usr/bin/env bun
/**
 * `bun run handoff:check`: typecheck, lint, tdd:audit and test:related --fast, in order, then one
 * stamp line to paste into the hand-off message, also kept in the worktree's git folder
 * (scripts/lib/handoff.ts). The stamp also says whether the required checks are green on HEAD
 * (`ci=0`; push first), from its PR run or main's push run (#266); `--no-ci` writes `ci=skip`, which
 * vouches for nothing. `--base <ref>` is for a branch stacked on another. `--verify` is for the
 * receiver: it checks the kept stamp against HEAD.
 * Never run it under the slot: test:related takes the slot by itself when it needs it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runHandoff, stampProblem } from "./lib/handoff.ts";
import { headCi } from "./lib/pr-flow.ts";

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? ""; // NOSONAR: git from the PATH of the developer running the script
const root = git(["rev-parse", "--show-toplevel"]) || resolve(import.meta.dir, "..");
const stampFile = resolve(root, git(["rev-parse", "--git-path", "flightdeck-handoff"]));
const head = git(["rev-parse", "HEAD"]);
const baseAt = process.argv.indexOf("--base");
const base = baseAt >= 0 ? process.argv[baseAt + 1] : undefined;

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
  ...(base ? { base } : {}),
  ci: async () =>
    process.argv.includes("--no-ci")
      ? "skip"
      : await headCi(head, {
          gh: (cmd) => spawnExec(["gh", ...cmd]),
          git: (cmd) => spawnExec(["git", ...cmd]),
          env: process.env,
          log: (line) => console.error(line),
        }),
});
writeFileSync(stampFile, `${result.stamp}\n`);
console.log(`\n${result.stamp}`);
process.exit(result.code);
