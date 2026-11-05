/**
 * The graders of `bun run scripts/harness-eval.ts` (issue #169, D7): a real headless session does
 * a small TDD task in a throwaway clone, and these deterministic checks read what it left (the
 * commits, its Bash steps from the stream-json transcript, the audit and test:related exit codes).
 * No model grades a model here.
 */

/** One task the eval gives a session. */
export interface EvalTask {
  name: string;
  /** The TDD area (the scope of its test and feat commits). */
  area: string;
  /** Where docs/TDD.md says the area's test goes. */
  testFile: string;
  prompt: string;
}

export interface EvalCommit {
  subject: string;
  /** The files the commit adds or changes. */
  files: string[];
}

/** One Bash call of the session and what it printed, in order. */
export interface EvalStep {
  command: string;
  output: string;
}

export interface Transcript {
  steps: EvalStep[];
  costUsd: number;
  turns: number;
  denials: number;
  isError: boolean;
}

export interface RunFacts extends Transcript {
  commits: EvalCommit[];
  auditCode: number;
  relatedCode: number;
}

interface StreamBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: unknown };
  tool_use_id?: string;
  content?: string | { type?: string; text?: string }[];
}

/** The Bash steps, cost, turns, denials and error flag of a `claude -p --output-format stream-json` run. */
export function parseStream(jsonl: string): Transcript {
  const steps: EvalStep[] = [];
  const byId = new Map<string, EvalStep>();
  const out: Transcript = { steps, costUsd: 0, turns: 0, denials: 0, isError: false };
  for (const line of jsonl.split("\n")) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result") {
      out.costUsd = Number(event.total_cost_usd ?? 0);
      out.turns = Number(event.num_turns ?? 0);
      out.denials = Array.isArray(event.permission_denials) ? event.permission_denials.length : 0;
      out.isError = event.is_error === true;
      continue;
    }
    const blocks = (event.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks as StreamBlock[]) {
      if (
        block.type === "tool_use" &&
        block.name === "Bash" &&
        typeof block.input?.command === "string"
      ) {
        const step = { command: block.input.command, output: "" };
        steps.push(step);
        byId.set(block.id ?? "", step);
      } else if (block.type === "tool_result") {
        const step = byId.get(block.tool_use_id ?? "");
        if (!step) continue;
        step.output =
          typeof block.content === "string"
            ? block.content
            : (block.content ?? []).map((c) => c.text ?? "").join("\n");
      }
    }
  }
  return out;
}

const GRADERS = ["test-file", "test-first", "red-by-assertion", "audit", "coverage", "no-error"];

/** Each grader's verdict on one run. */
export function grade(task: EvalTask, facts: RunFacts): Record<string, boolean> {
  const isTest = (c: EvalCommit) => c.subject.startsWith(`test(${task.area})`);
  const isFeat = (c: EvalCommit) =>
    /^(feat|fix)\(/.test(c.subject) && c.subject.includes(`(${task.area})`);
  const firstTest = facts.commits.findIndex(isTest);
  const firstFeat = facts.commits.findIndex(isFeat);
  const testCommitStep = facts.steps.findIndex(
    (s) => s.command.includes("git commit") && s.command.includes(`test(${task.area})`),
  );
  // A red that counts: a bun test run of the area that fails on an expect, before the test commit.
  const redStep = facts.steps.findIndex(
    (s) =>
      /\bbun\b.*\btest\b/.test(s.command) &&
      s.command.includes(task.area) &&
      /error: expect\(/.test(s.output) &&
      /^\s*[1-9]\d* fail$/m.test(s.output),
  );
  return {
    "test-file": facts.commits.some((c) => isTest(c) && c.files.includes(task.testFile)),
    "test-first": firstTest >= 0 && firstFeat > firstTest,
    "red-by-assertion": redStep >= 0 && testCommitStep > redStep,
    audit: facts.auditCode === 0,
    coverage: facts.relatedCode === 0,
    "no-error": !facts.isError,
  };
}

/** The scorecard of the samples of one task: each grader's pass count, then cost and turns. */
export function scorecard(task: EvalTask, runs: RunFacts[]): string {
  const verdicts = runs.map((run) => grade(task, run));
  const width = Math.max(...GRADERS.map((g) => g.length)) + 2;
  const costs = runs.map((r) => r.costUsd);
  const turns = runs.map((r) => r.turns);
  const total = costs.reduce((a, b) => a + b, 0);
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const passes = (g: string) => verdicts.filter((v) => v[g]).length;
  return [
    `${task.name}: ${runs.length} sample(s)`,
    ...GRADERS.map((g) => `  ${g.padEnd(width)}${passes(g)}/${runs.length}`),
    `  cost: ${usd(total)} in all, ${usd(total / runs.length)} a run (min ${usd(Math.min(...costs))}, max ${usd(Math.max(...costs))})`,
    `  turns: ${Math.round(turns.reduce((a, b) => a + b, 0) / runs.length)} a run (min ${Math.min(...turns)}, max ${Math.max(...turns)}); permission denials: ${runs.reduce((a, r) => a + r.denials, 0)}`,
  ].join("\n");
}
