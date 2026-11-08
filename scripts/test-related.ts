#!/usr/bin/env bun
/**
 * `bun run test:related [--base <ref>] [--fast] [--tier unit,component] [--pr] [--keep-coverage <dir>]`:
 * runs only the tests that reach the files changed since the base (`--fast`: only the tests that
 * import them directly; `--tier`: only those tiers, classified from the code, without the coverage
 * gate; `--pr`: every unit and component test plus the related tests of the other tiers, the PR's
 * check on CI, #309), and checks the changed files' coverage. `--keep-coverage` writes the lcov
 * report into that folder and keeps it (SonarCloud reads it). `--list <file>` writes the selected
 * test files there, one per line (`*` for the whole suite), and runs nothing: the Windows shards
 * of a PR run that list (#399).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkChanged, wholeSuiteCheck } from "./lib/related-coverage.ts";
import { keepCoverageProblem, listSelection, planRelated } from "./lib/test-related.ts";
import { testTiers } from "./lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "..");

function liveTiers(): Record<string, string> {
  const listed = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" }); // NOSONAR: git comes from the PATH of the developer running the script
  const paths = listed.stdout.split("\n").filter(Boolean);
  return testTiers(new Map(paths.map((p) => [p, readFileSync(resolve(ROOT, p), "utf8")])));
}
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = args.indexOf("--base");
// --fast: the changed tests and the tests that import a changed file directly (#219).
const fast = args.includes("--fast");
// --tier: only the tests of these tiers (#261), for a session on a small machine; CI runs them all.
const tierFlag = args.indexOf("--tier");
const tiers = tierFlag >= 0 ? (args[tierFlag + 1] ?? "").split(",").filter(Boolean) : undefined;
// The tiers are computed from the code on every call (lib/test-tiers.ts), never read from a file.
// --pr (#309): the PR's check on CI.
const pyramid = args.includes("--pr");
const tierMap: Record<string, string> = tiers || pyramid ? liveTiers() : {};
const keepFlag = args.indexOf("--keep-coverage");
const keep = keepFlag >= 0 ? args[keepFlag + 1] : undefined;
// The kept folder stays inside the repository, and is never another flag.
if (keepFlag >= 0) {
  const problem = keepCoverageProblem(ROOT.replaceAll("\\", "/"), keep?.replaceAll("\\", "/"));
  if (problem) {
    console.error(`test:related: ${problem}`);
    process.exit(2);
  }
}

const coverageDir = keep ? resolve(ROOT, keep) : mkdtempSync(join(tmpdir(), "test-related-"));
// A report left by an earlier run must never stand in for this one's.
if (keep) rmSync(join(coverageDir, "lcov.info"), { force: true });
const plan = planRelated({
  coverageDir,
  fast,
  ...(tiers ? { tiers } : {}),
  ...(tiers || pyramid ? { tierOf: (path: string) => tierMap[path] } : {}),
  pyramid,
  // CI has the machine to itself: no machine-wide slot there.
  slot: !process.env.CI,
  base: flag >= 0 ? args[flag + 1] : undefined,
  platform: process.platform,
  git: (gitArgs) => {
    const options = { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 } as const;
    const proc = spawnSync("git", gitArgs, options); // NOSONAR: git and bun come from the PATH of the developer running the script
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
});
(plan.code === 0 ? console.log : console.error)(plan.output);
const listFlag = args.indexOf("--list");
if (listFlag >= 0) {
  if (!keep) rmSync(coverageDir, { recursive: true, force: true });
  const listed = listSelection(plan, args[listFlag + 1], (path, text) =>
    writeFileSync(resolve(ROOT, path), text),
  );
  (listed.code === 0 ? console.log : console.error)(listed.line);
  process.exit(listed.code);
}
if (!plan.command) {
  if (!keep) rmSync(coverageDir, { recursive: true, force: true });
  process.exit(plan.code);
}
const check = wholeSuiteCheck(plan.wholeCoverage && resolve(ROOT, plan.wholeCoverage), {
  remove: (path) => rmSync(path, { force: true }),
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
});
const [cmd = "bun", ...rest] = plan.command;
const proc = Bun.spawn([cmd === "bun" ? process.execPath : cmd, ...rest], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});
let code = await proc.exited;

// #996: Bun's 100% threshold fails a whole-suite run with exit code 1 and no word on why.
const wholeVerdict = check(code);
if (wholeVerdict) console.error(`\n${wholeVerdict}`);

// The changed source files must be at 100% lines and functions, as the full suite demands.
const targets = plan.targets ?? [];
if (targets.length > 0) {
  const lcov = join(coverageDir, "lcov.info");
  let report = "";
  try {
    report = readFileSync(lcov, "utf8");
  } catch {
    console.error("test:related: the run left no coverage report");
    code ||= 1;
  }
  const verdict = checkChanged(report, targets);
  if (report && verdict.problems.length > 0) {
    console.error(
      `\ntest:related: ${verdict.problems.length} changed file(s) below 100% coverage:`,
    );
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    if (verdict.functionGaps.length > 0) {
      // Names the functions no test called (one more run of the same tests).
      const tests = rest.filter((arg) => /^\.\/.+\.test\.tsx?$/.test(arg));
      const named = Bun.spawnSync(
        [process.execPath, "run", "coverage:funcs", ...verdict.functionGaps, "--tests", ...tests],
        { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
      );
      if (named.exitCode !== 0) console.error("(coverage:funcs could not name the functions)");
    }
    code ||= 1;
  } else if (report) {
    console.log(`\ntest:related: ${targets.length} changed source file(s) fully covered`);
  }
}
if (!keep) rmSync(coverageDir, { recursive: true, force: true });
process.exit(code);
