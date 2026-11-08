#!/usr/bin/env bun
/**
 * `bun run scripts/ux-review-eval.ts [--samples 1] [--budget 0.5] [--model sonnet] [--keep]`:
 * measures the `ux-reviewer` agent (issue #983). For each case and sample it clones HEAD into a
 * temporary folder (origin removed), commits one known-bad UI change there, runs
 * `claude -p --agent ux-reviewer` on it with no Edit or Write, and grades the report with the
 * deterministic checks of scripts/lib/ux-review-eval.ts. The session gets no token or key from the
 * environment. It costs real quota: opt-in only, never in the suite or CI, and never under the slot.
 * Linux and macOS only: it refuses Windows, where its git deny patterns miss backslash paths.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { whichOnPath } from "../apps/daemon/src/which.ts";
import { type EvalHost, evalContext, evalOptions, prepareClone } from "./lib/harness-eval.ts";
import {
  applyCase,
  gradeReport,
  reportOf,
  reviewArgs,
  reviewPrompt,
  UX_CASES,
  uxScorecard,
} from "./lib/ux-review-eval.ts";

const argv = process.argv.slice(2);
const options = evalOptions([
  ...(argv.includes("--samples") ? [] : ["--samples", "1"]),
  ...(argv.includes("--budget") ? [] : ["--budget", "0.5"]),
  ...argv,
]);
if (typeof options === "string") {
  console.error(`ux-review-eval: ${options}`);
  process.exit(2);
}
const spawn: EvalHost["spawn"] = (command, cwd, env) => {
  const proc = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return { code: proc.status ?? 1, out: proc.stdout ?? "" };
};
const context = evalContext("ux-review-eval", {
  platform: process.platform,
  which: whichOnPath,
  spawn,
  cwd: process.cwd(),
  env: process.env,
});
if (typeof context === "string") {
  console.error(context);
  process.exit(2);
}
const { claude, run, root, head } = context;
// The reports hold what the agent read: a 0700 folder, 0600 files.
const outDir = mkdtempSync(join(tmpdir(), "fd-ux-review-eval-"));

const results: { name: string; passed: boolean[] }[] = [];
for (const uxCase of UX_CASES) {
  const passed: boolean[] = [];
  for (let sample = 1; sample <= options.samples; sample++) {
    const dir = mkdtempSync(join(tmpdir(), `fd-ux-eval-${uxCase.name}-`));
    const fail = (why: string): never => {
      rmSync(dir, { recursive: true, force: true });
      console.error(why);
      process.exit(1);
    };
    const failed = prepareClone(run, { root, head, dir, bun: process.execPath });
    if (failed) fail(failed);
    const base = run(["git", "rev-parse", "HEAD"], dir).out.trim();
    const applied = applyCase(uxCase, (path) => {
      try {
        return readFileSync(join(dir, path), "utf8");
      } catch {
        return null;
      }
    });
    if (typeof applied === "string") fail(applied);
    else {
      for (const { path, text } of applied.writes) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      const paths = applied.writes.map((w) => w.path);
      const added = run(["git", "add", "--", ...paths], dir).code === 0;
      // The planted change is the eval's, not a session's: the repo's commit hooks do not judge it.
      const committed =
        added &&
        run(["git", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", uxCase.subject], dir)
          .code === 0;
      if (!committed) fail(`ux-review-eval: the ${uxCase.name} change did not commit in ${dir}`);
    }
    // The diff goes in the prompt, so the review needs no git (#986 security review).
    const diff = run(["git", "diff", `${base}..HEAD`], dir).out;
    console.error(`ux-review-eval: ${uxCase.name} sample ${sample}/${options.samples} in ${dir}`);
    const session = run(
      [claude, ...reviewArgs(reviewPrompt(base, diff), options, { dir, home: homedir() })],
      dir,
    );
    const report = reportOf(session.out);
    writeFileSync(join(outDir, `${uxCase.name}-${sample}.md`), report, { mode: 0o600 });
    passed.push(gradeReport(uxCase.expect, report));
    if (!options.keep) rmSync(dir, { recursive: true, force: true });
  }
  results.push({ name: uxCase.name, passed });
}
console.log(uxScorecard(results));
console.log(`\nux-review-eval: the reports are in ${outDir}`);
