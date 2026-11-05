#!/usr/bin/env bun
/**
 * `bun run scripts/harness-eval.ts [--samples 3] [--budget 1] [--model sonnet] [--keep]`: measures
 * the harness on a real headless session. For each sample it clones HEAD into a temporary folder
 * (origin removed, so nothing can be pushed back), runs `claude -p` on a small TDD task with the
 * repo's own CLAUDE.md, rules and hooks, and grades what the session left with deterministic
 * checks (scripts/lib/harness-eval.ts). It costs real quota: opt-in only, never in the suite or CI,
 * and never under the slot (the model's turn is not a heavy run).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type EvalCommit,
  type EvalTask,
  parseStream,
  type RunFacts,
  scorecard,
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

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const samples = Number(option("--samples", "3"));
const budget = option("--budget", "1");
const model = option("--model", "sonnet");

const run = (command: string[], cwd: string) => {
  const proc = spawnSync(command[0] ?? "", command.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return { code: proc.status ?? 1, out: proc.stdout ?? "" };
};
const root =
  run(["git", "rev-parse", "--show-toplevel"], process.cwd()).out.trim() ||
  resolve(import.meta.dir, "..");
const head = run(["git", "rev-parse", "HEAD"], root).out.trim();

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
  for (let sample = 1; sample <= samples; sample++) {
    const dir = mkdtempSync(join(tmpdir(), `fd-eval-${task.name}-`));
    run(["git", "clone", "--quiet", root, dir], tmpdir());
    run(["git", "checkout", "--quiet", head], dir);
    run(["git", "remote", "remove", "origin"], dir);
    run([process.execPath, "install", "--frozen-lockfile"], dir);
    const start = run(["git", "rev-parse", "HEAD"], dir).out.trim();
    console.error(`harness-eval: ${task.name} sample ${sample}/${samples} in ${dir}`);
    const session = run(
      [
        "claude",
        "-p",
        task.prompt,
        "--model",
        model,
        "--max-budget-usd",
        budget,
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read",
        "Edit",
        "Write",
        "Bash(bun --config=bunfig.area.toml test *)",
        "Bash(bun run test:related*)",
        "Bash(bun run tdd:audit*)",
        "Bash(bun run typecheck*)",
        // What CLAUDE.md tells a session to run: lint before a hand-off, and the CLAUDECODE
        // gotcha that shows the (pass) lines. The first live run was denied all three.
        "Bash(bun run lint*)",
        "Bash(bun x biome *)",
        "Bash(env -u CLAUDECODE bun --config=bunfig.area.toml test *)",
        "Bash(git status*)",
        "Bash(git add *)",
        "Bash(git commit *)",
        "Bash(git log*)",
        "Bash(git diff*)",
        "--disallowedTools",
        "Bash(git push *)",
        "Bash(git remote *)",
      ],
      dir,
    );
    writeFileSync(`${dir}.jsonl`, session.out);
    const facts: RunFacts = {
      ...parseStream(session.out),
      commits: commitsSince(dir, start),
      auditCode: run([process.execPath, "run", "tdd:audit", "--", "--since", start], dir).code,
      relatedCode: run([process.execPath, "run", "test:related", "--", "--base", start], dir).code,
    };
    runs.push(facts);
    report.push({ task: task.name, sample, facts });
    if (!args.includes("--keep")) rmSync(dir, { recursive: true, force: true });
  }
  console.log(scorecard(task, runs));
}
const out = join(tmpdir(), `fd-harness-eval-${Date.now()}.json`);
writeFileSync(out, JSON.stringify({ head, model, budget, report }, null, 2));
console.log(`\nharness-eval: the full report is in ${out}`);
