#!/usr/bin/env bun
/** `bun run test:related [--base <ref>]`: runs only the tests that reach the files changed since the base. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkChanged } from "./lib/related-coverage.ts";
import { planRelated } from "./lib/test-related.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = args.indexOf("--base");

const coverageDir = mkdtempSync(join(tmpdir(), "test-related-"));
const plan = planRelated({
  coverageDir,
  base: flag >= 0 ? args[flag + 1] : undefined,
  platform: process.platform,
  git: (gitArgs) => {
    const proc = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
});
(plan.code === 0 ? console.log : console.error)(plan.output);
if (!plan.command) {
  rmSync(coverageDir, { recursive: true, force: true });
  process.exit(plan.code);
}
const [cmd = "bun", ...rest] = plan.command;
const proc = Bun.spawn([cmd === "bun" ? process.execPath : cmd, ...rest], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});
let code = await proc.exited;

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
rmSync(coverageDir, { recursive: true, force: true });
process.exit(code);
