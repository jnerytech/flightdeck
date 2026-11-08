#!/usr/bin/env bun
/**
 * `bun run scripts/harness-eval.ts [--samples 3] [--budget 1] [--model sonnet] [--keep]`: measures
 * the harness on a real headless session. For each sample it clones HEAD into a temporary folder
 * (origin removed, so nothing can be pushed back), runs `claude -p` on a small TDD task with the
 * repo's own CLAUDE.md, rules and hooks, and grades what the session left with deterministic
 * checks (scripts/lib/harness-eval.ts). The session's processes get no token or key from the
 * environment, and its files are scoped to the clone; the tests it writes still run as you, so
 * run it only where that is acceptable. It costs real quota: opt-in only, never in the suite or CI,
 * and never under the slot (the model's turn is not a heavy run).
 * Linux and macOS only: it refuses Windows, where its git deny patterns miss backslash paths.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startEval } from "./eval-start.ts";
import {
  type EvalCommit,
  type EvalTask,
  parseStream,
  prepareClone,
  type RunFacts,
  savedFacts,
  scorecard,
  sessionArgs,
} from "./lib/harness-eval.ts";

const TASKS: EvalTask[] = [
  {
    name: "slug-case",
    area: "slug-case",
    testFile: "scripts/test/slug-case.test.ts",
    prompt: [
      "Implement the TDD area `slug-case` in this repository, following CLAUDE.md and docs/TDD.md.",
      "The area is a pure function `slugCase(text: string): string` in `scripts/lib/slug-case.ts`:",
      "lowercase, accents removed, every run of characters that are not letters or digits becomes",
      "one '-', and no '-' at either end ('Olá, Mundo!' gives 'ola-mundo').",
      "Commit the failing test alone first, then the implementation. Stage files by explicit path.",
      "Do not push. When done, reply with the two commit hashes.",
    ].join(" "),
  },
];

const options = startEval("harness-eval", process.argv.slice(2));
const { claude, run, root, head } = options;
// Transcripts and the report hold what the session read and ran: a 0700 folder, 0600 files.
const outDir = mkdtempSync(join(tmpdir(), "fd-harness-eval-"));
const save = (name: string, text: string) => {
  const path = join(outDir, name);
  writeFileSync(path, text, { mode: 0o600 });
  return path;
};

/** The commits since `start`, with their files. */
function commitsSince(dir: string, start: string): EvalCommit[] {
  return run(["git", "log", "--reverse", "--format=%x1e%s", "--name-only", `${start}..HEAD`], dir)
    .out.split("\x1e")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const [subject = "", ...files] = block.trim().split("\n");
      return { subject, files: files.filter(Boolean) };
    });
}

const report: { task: string; sample: number; facts: RunFacts }[] = [];
for (const task of TASKS) {
  const runs: RunFacts[] = [];
  for (let sample = 1; sample <= options.samples; sample++) {
    const dir = mkdtempSync(join(tmpdir(), `fd-eval-${task.name}-`));
    const failed = prepareClone(run, { root, head, dir, bun: process.execPath });
    if (failed) {
      rmSync(dir, { recursive: true, force: true });
      console.error(failed);
      process.exit(1);
    }
    const start = run(["git", "rev-parse", "HEAD"], dir).out.trim();
    console.error(`harness-eval: ${task.name} sample ${sample}/${options.samples} in ${dir}`);
    const session = run(
      [claude, ...sessionArgs(task.prompt, options, { dir, home: homedir() })],
      dir,
    );
    if (options.keep) save(`${task.name}-${sample}.jsonl`, session.out);
    const facts: RunFacts = {
      ...parseStream(session.out),
      commits: commitsSince(dir, start),
      auditCode: run([process.execPath, "run", "tdd:audit", "--", "--since", start], dir).code,
      relatedCode: run([process.execPath, "run", "test:related", "--", "--base", start], dir).code,
    };
    runs.push(facts);
    report.push({ task: task.name, sample, facts: savedFacts(facts) });
    if (!options.keep) rmSync(dir, { recursive: true, force: true });
  }
  console.log(scorecard(task, runs));
}
const { samples, budget, model } = options;
const out = save("report.json", JSON.stringify({ head, model, budget, samples, report }, null, 2));
console.log(`\nharness-eval: the full report is in ${out}`);
