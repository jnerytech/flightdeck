#!/usr/bin/env bun
/**
 * `bun run handoff:check`: typecheck, lint, tdd:audit and test:related --fast, in order, then one
 * stamp line to paste into the hand-off message, also kept in the worktree's git folder
 * (scripts/lib/handoff.ts). The stamp also says whether the required checks are green on HEAD
 * (`ci=0`; push first), from its PR run or main's push run (#266); `--no-ci` writes `ci=skip`, which
 * vouches for nothing. `security=0` unless a change in a risk area (spawn, delete, secret,
 * permission, vault, pairing) has no `Security-Reviewed:` trailer after it (#273).
 * `--base <ref>` is for a branch stacked on another. `--verify` is for the
 * receiver: it checks the kept stamp against HEAD.
 * Never run it under the slot: test:related takes the slot by itself when it needs it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnExec } from "../apps/daemon/src/exec.ts";
import { runHandoff, stampProblem } from "./lib/handoff.ts";
import { headCi } from "./lib/pr-flow.ts";
import { addedLines, parseBranchLog, riskyFiles, securityProblem } from "./lib/security-gate.ts";
import { auditBase } from "./lib/tdd-audit.ts";

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

/** The security gate (#273): "0", or "unreviewed" after printing the risky files and what to do. */
function securityGate(): string {
  const run = (args: string[]) => {
    const proc = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 2 ** 20 }); // NOSONAR: git from the PATH of the developer running the script
    return proc.status === 0 ? proc.stdout : null;
  };
  // --base is resolved to a commit first: a value that starts with "-" never reaches git as an option.
  const asked = base
    ? run(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])
    : null;
  const ref = (base ? asked : auditBase(run))?.trim();
  if (!ref) return "unknown";
  // Names unquoted (core.quotepath), and a merge lists the files it edited itself (combined).
  const quiet = ["-c", "core.quotepath=off"];
  const diff = run([...quiet, "diff", "-U0", "--no-color", `${ref}...HEAD`]) ?? "";
  const log = run([
    ...quiet,
    "log",
    "--diff-merges=combined",
    "--format=%x1e%H%x1f%(trailers:key=Security-Reviewed,valueonly,separator=%x20)",
    "--name-only",
    `${ref}..HEAD`,
  ]);
  const problem = securityProblem(riskyFiles(addedLines(diff)), parseBranchLog(log ?? ""));
  if (problem) console.error(`\n${problem}`);
  return problem ? "unreviewed" : "0";
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
  security: async () => securityGate(),
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
