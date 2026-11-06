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

/** One line of the stream as an object; null when it is not one. */
function eventOf(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The command of a Bash tool call, or null for any other block. */
function bashCommand(block: StreamBlock): string | null {
  if (block.type !== "tool_use" || block.name !== "Bash") return null;
  return typeof block.input?.command === "string" ? block.input.command : null;
}

/** The text of what a tool answered. */
function resultText(content: StreamBlock["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((c) => c.text ?? "").join("\n");
}

/** The Bash steps, cost, turns, denials and error flag of a `claude -p --output-format stream-json` run. */
export function parseStream(jsonl: string): Transcript {
  const steps: EvalStep[] = [];
  const byId = new Map<string, EvalStep>();
  const out: Transcript = { steps, costUsd: 0, turns: 0, denials: 0, isError: false };
  for (const line of jsonl.split("\n")) {
    const event = eventOf(line);
    if (!event) continue;
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
      const command = bashCommand(block);
      if (command !== null) {
        const step = { command, output: "" };
        steps.push(step);
        byId.set(block.id ?? "", step);
      } else if (block.type === "tool_result") {
        const step = byId.get(block.tool_use_id ?? "");
        if (step) step.output = resultText(block.content);
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

/** The CLI's options, checked: whole samples of at least 1 and a positive budget in USD. */
export interface EvalOptions {
  samples: number;
  budget: string;
  model: string;
  keep: boolean;
}

/** The options from `argv`, or the reason they are refused. */
export function evalOptions(argv: string[]): EvalOptions | string {
  const option = (name: string, fallback: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? (argv[at + 1] ?? fallback) : fallback;
  };
  const samples = Number(option("--samples", "3"));
  if (!Number.isInteger(samples) || samples < 1)
    return "--samples must be a whole number of at least 1";
  const budget = option("--budget", "1");
  if (!(Number(budget) > 0)) return "--budget must be a positive number of USD";
  return { samples, budget, model: option("--model", "sonnet"), keep: argv.includes("--keep") };
}

/** The tools a sample may use without asking: the clone's files and what CLAUDE.md tells it to run. */
const ALLOWED_TOOLS = [
  "Read(./**)",
  "Edit(./**)",
  "Write(./**)",
  "Bash(bun --config=bunfig.area.toml test *)",
  "Bash(bun run test:related*)",
  "Bash(bun run tdd:audit*)",
  "Bash(bun run typecheck*)",
  // What CLAUDE.md tells a session to run: lint before a hand-off, and the CLAUDECODE gotcha that
  // shows the (pass) lines. The first live run was denied all three.
  "Bash(bun run lint*)",
  "Bash(bun x biome *)",
  "Bash(env -u CLAUDECODE bun --config=bunfig.area.toml test *)",
  "Bash(git status*)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(git log)",
  "Bash(git log *)",
  "Bash(git diff)",
  "Bash(git diff *)",
];

/** What a sample may never do, even when an allowed pattern matches it. */
const DENIED_TOOLS = ["Bash(git push *)", "Bash(git remote *)", "Bash(git * --output*)"];

/**
 * The `claude -p` arguments of one sample. Read, Edit and Write are scoped to the clone (the
 * session's working directory); when the clone is outside `home`, the home folder is denied too,
 * and so are `git push`, `git remote` and a git `--output` that writes a file.
 */
export function sessionArgs(
  prompt: string,
  options: Pick<EvalOptions, "model" | "budget">,
  places: { dir: string; home: string },
): string[] {
  const home = places.home.replace(/[\\/]+$/, "");
  const inHome =
    places.dir === home ||
    (places.dir.startsWith(home) && /^[\\/]/.test(places.dir.slice(home.length)));
  const homeDenied = inHome ? [] : ["Read(~/**)", "Edit(~/**)", "Write(~/**)"];
  return [
    "-p",
    prompt,
    "--model",
    options.model,
    "--max-budget-usd",
    options.budget,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ...ALLOWED_TOOLS,
    "--disallowedTools",
    ...DENIED_TOOLS,
    ...homeDenied,
  ];
}

/** The environment variables a sample's processes keep: no token, key or other secret. */
const CHILD_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "SystemRoot",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PATHEXT",
  "ComSpec",
]);

/** `env` reduced to {@link CHILD_ENV}: the clone, `bun install` and the session get nothing else. */
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && CHILD_ENV.has(name)) kept[name] = value;
  }
  return kept;
}

/** Runs a command in a folder and gives its exit code and stdout. */
export type EvalRunner = (command: string[], cwd: string) => { code: number; out: string };

/**
 * Clones `root` at `head` into `dir`, removes origin and installs the dependencies; the reason it
 * failed, or null. A clone that still has a remote is refused: the session must not reach the
 * real repository.
 */
export function prepareClone(
  run: EvalRunner,
  places: { root: string; head: string; dir: string; bun: string },
): string | null {
  const { root, head, dir, bun } = places;
  const steps: [string, string[], string][] = [
    ["clone", ["git", "clone", "--quiet", root, dir], root],
    ["checkout", ["git", "checkout", "--quiet", head], dir],
    ["remove origin", ["git", "remote", "remove", "origin"], dir],
  ];
  for (const [name, command, cwd] of steps) {
    if (run(command, cwd).code !== 0) return `harness-eval: the ${name} step failed in ${dir}`;
  }
  const remotes = run(["git", "remote"], dir);
  if (remotes.code !== 0 || remotes.out.trim() !== "") {
    return `harness-eval: the clone in ${dir} still has a remote; refusing to start the session`;
  }
  if (run([bun, "install", "--frozen-lockfile"], dir).code !== 0) {
    return `harness-eval: the install step failed in ${dir}`;
  }
  return null;
}

/** A run's facts as the saved report keeps them: each step's command, never its output. */
export function savedFacts(facts: RunFacts): RunFacts {
  return { ...facts, steps: facts.steps.map((step) => ({ command: step.command, output: "" })) };
}
