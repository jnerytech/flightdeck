#!/usr/bin/env bun
/**
 * `bun run handoff:check [--base <ref>] [--no-ci]`: typecheck, lint, tdd:audit and test:related
 * --fast, in order, then the CI state of HEAD (a push trigger and a green run, #221), and one stamp
 * line to paste into the hand-off message, also kept in the worktree's git folder
 * (scripts/lib/handoff.ts). `--base` is for a branch made from an rc; `--no-ci` checks only the
 * local tier and writes `ci=skip`, which `--verify` refuses. `--verify` is for the receiver: it
 * checks the kept stamp against HEAD. Never run it under the slot: test:related takes the slot by
 * itself when it needs it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ciVerdict, pushTrigger, runHandoff, stampProblem } from "./lib/handoff.ts";

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";
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

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args[baseAt + 1] : undefined;

/** The CI state of HEAD: the branch must run CI on push (#217) and have a green run (#221). */
async function ci(): Promise<string> {
  if (args.includes("--no-ci")) return "skip";
  const ciYaml = spawnSync("git", ["show", "HEAD:.github/workflows/ci.yml"], { encoding: "utf8" });
  if (!pushTrigger(ciYaml.status === 0 ? ciYaml.stdout : null)) {
    console.error(
      "handoff:check: this branch's ci.yml has no push trigger (it predates #217), so a push runs no CI: merge origin/main into it",
    );
    return "no-trigger";
  }
  const list = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--commit",
      head,
      "--json",
      "status,conclusion",
      "--limit",
      "10",
    ],
    { encoding: "utf8" },
  );
  const state = ciVerdict(list.status === 0 ? list.stdout : null);
  if (state !== "0") {
    console.error(
      `handoff:check: CI for ${head.slice(0, 9)} is ${state}: push the branch and wait for a green run (bun run ci:branch reads it)`,
    );
  }
  return state;
}

const result = await runHandoff({
  ...(base ? { base } : {}),
  ci,
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
