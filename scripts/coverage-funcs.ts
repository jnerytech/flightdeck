#!/usr/bin/env bun
/**
 * `bun run coverage:funcs <file.ts>...`: runs the tests that reach the files and lists the functions
 * of those files that no test called, as `file:line`. Bun's coverage counts functions per file but
 * does not name them; this does, with istanbul. The files are instrumented in memory, never rewritten.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatReport, planCoverageFuncs } from "./lib/coverage-funcs.ts";

const ROOT = resolve(import.meta.dir, "..");
const files = process.argv.slice(2).filter((a) => a !== "--");
const dir = mkdtempSync(join(tmpdir(), "coverage-funcs-"));
const out = join(dir, "coverage.json");
writeFileSync(out, "{}");

const plan = planCoverageFuncs({
  files,
  platform: process.platform,
  git: (args) => {
    const proc = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    return proc.status === 0 ? proc.stdout : null;
  },
  readFile: (path) => readFileSync(resolve(ROOT, path), "utf8"),
  out,
});
(plan.code === 0 ? console.log : console.error)(plan.output);
let code = plan.code;
if (plan.command) {
  const [cmd = "bun", ...rest] = plan.command;
  const proc = Bun.spawn([cmd === "bun" ? process.execPath : cmd, ...rest], {
    cwd: ROOT,
    env: { ...process.env, ...plan.env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  code = await proc.exited;
  const targets = (JSON.parse(plan.env.COVERAGE_FUNCS_FILES ?? "[]") as string[]).map((file) => ({
    file,
    source: readFileSync(resolve(ROOT, file), "utf8"),
  }));
  console.log(`\n${formatReport(targets, JSON.parse(readFileSync(out, "utf8")))}`);
}
rmSync(dir, { recursive: true, force: true });
process.exit(code);
