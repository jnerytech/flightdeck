#!/usr/bin/env bun
/**
 * `bun run scripts/test-review-eval.ts [--samples 1] [--budget 0.5] [--model sonnet] [--keep]`:
 * measures the `test-quality-reviewer` agent on the Khorikov criteria (issue #1604). For each case
 * and sample it clones HEAD into a temporary folder (origin removed), commits the case's test and
 * feat pair there, runs `claude -p --agent test-quality-reviewer` on it with no Edit, Write or git,
 * and grades the report with the deterministic checks of scripts/lib/evals/test-review-eval.ts. The
 * session gets no token or key from the environment. It costs real quota: opt-in only, never in
 * the suite or CI, and never under the slot. Linux and macOS only, like the other evals.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startEval } from "./eval-start.ts";
import { prepareClone } from "./lib/evals/harness-eval.ts";
import {
  gradeTestReview,
  TEST_REVIEW_CASES,
  testReviewArgs,
  testReviewPrompt,
} from "./lib/evals/test-review-eval.ts";
import { reportOf, uxScorecard } from "./lib/evals/ux-review-eval.ts";

const argv = process.argv.slice(2);
const options = startEval("test-review-eval", [
  ...(argv.includes("--samples") ? [] : ["--samples", "1"]),
  ...(argv.includes("--budget") ? [] : ["--budget", "0.5"]),
  ...argv,
]);
const { run, root, head } = options;
// The reports hold what the agent read: a 0700 folder, 0600 files.
const outDir = mkdtempSync(join(tmpdir(), "fd-test-review-eval-"));

const results: { name: string; passed: boolean[] }[] = [];
for (const reviewCase of TEST_REVIEW_CASES) {
  const passed: boolean[] = [];
  for (let sample = 1; sample <= options.samples; sample++) {
    const dir = mkdtempSync(join(tmpdir(), `fd-tq-eval-${reviewCase.name}-`));
    const fail = (why: string): never => {
      rmSync(dir, { recursive: true, force: true });
      console.error(why);
      process.exit(1);
    };
    const failed = prepareClone(run, { root, head, dir, bun: process.execPath });
    if (failed) fail(failed);
    const base = run(["git", "rev-parse", "HEAD"], dir).out.trim();
    for (const commit of reviewCase.commits) {
      for (const { path, content } of commit.files) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      const paths = commit.files.map((file) => file.path);
      const message = commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
      const added = run(["git", "add", "--", ...paths], dir).code === 0;
      // The planted pair is the eval's, not a session's: the repo's commit hooks do not judge it.
      const committed =
        added &&
        run(["git", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", message], dir).code ===
          0;
      if (!committed) fail(`test-review-eval: "${commit.subject}" did not commit in ${dir}`);
    }
    // The commits go in the prompt, so the review needs no git (#986 security review).
    const shown = run(
      ["git", "log", "--reverse", "-p", "--format=fuller", `${base}..HEAD`],
      dir,
    ).out;
    const testFile = reviewCase.commits[0]?.files[0]?.path ?? "";
    console.error(
      `test-review-eval: ${reviewCase.name} sample ${sample}/${options.samples} in ${dir}`,
    );
    const session = run(
      [
        options.claude,
        ...testReviewArgs(
          testReviewPrompt(base, shown),
          options,
          { dir, home: homedir() },
          testFile,
        ),
      ],
      dir,
    );
    const report = reportOf(session.out);
    writeFileSync(join(outDir, `${reviewCase.name}-${sample}.md`), report, { mode: 0o600 });
    passed.push(gradeTestReview(reviewCase.expect, report));
    if (!options.keep) rmSync(dir, { recursive: true, force: true });
  }
  results.push({ name: reviewCase.name, passed });
}
console.log(uxScorecard(results));
console.log(`\ntest-review-eval: the reports are in ${outDir}`);
