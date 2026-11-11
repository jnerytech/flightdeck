/**
 * Issue #1918: an issue body is a mini-spec in a checked format (docs/issue-format.md). `checkIssue`
 * lists what is wrong with a body; `runIssue` is the CLI behind `bun run issue -- check|new|edit`.
 */
import type { GhResult } from "./ci-branch.ts";

export interface IssueDeps {
  /** Runs `gh <args>` in the repository. */
  gh(args: string[]): Promise<GhResult>;
  /** The text of a file, or null when it cannot be read. */
  readFile(path: string): string | null;
  log(line: string): void;
}

const KINDS = ["feature", "bug", "refactor", "task"] as const;
type Kind = (typeof KINDS)[number];
const REPO = "jnerytech/flightdeck";
const ASSIGNEE = "jnerytech";
const USAGE =
  'usage: bun run issue -- check (--body-file <md> | <n>) | new --title "<t>" --body-file <md> | edit <n> --body-file <md>';

type Need = "required" | "optional" | "no";
/** The sections each kind asks for, in the order the doc lists them (the table of docs/issue-format.md). */
const SECTIONS: Array<[name: string, need: Record<Kind, Need>]> = [
  ["Why", { feature: "required", bug: "required", refactor: "required", task: "required" }],
  ["Scope", { feature: "required", bug: "no", refactor: "required", task: "required" }],
  [
    "Out of scope",
    { feature: "required", bug: "optional", refactor: "required", task: "optional" },
  ],
  ["What happens", { feature: "no", bug: "required", refactor: "no", task: "no" }],
  ["Expected", { feature: "no", bug: "required", refactor: "no", task: "no" }],
  ["Repro", { feature: "no", bug: "required", refactor: "no", task: "no" }],
  ["Scenarios", { feature: "required", bug: "required", refactor: "no", task: "optional" }],
  ["Tasks", { feature: "required", bug: "optional", refactor: "required", task: "optional" }],
  ["Done when", { feature: "required", bug: "required", refactor: "required", task: "required" }],
];

/** The text under each `## ` heading, outside code fences; a repeated heading keeps its first text. */
function sectionsOf(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let name: string | null = null;
  let fenced = false;
  let text: string[] = [];
  const close = () => {
    if (name !== null && !found.has(name)) found.set(name, text.join("\n"));
  };
  for (const line of body.split("\n").slice(1)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^## (.+?)\s*$/.exec(line);
    if (heading) {
      close();
      name = heading[1] as string;
      text = [];
    } else text.push(line);
  }
  close();
  return found;
}

/** The items of a list: its `- ` or `1. ` lines, without the marker. */
const itemsOf = (text: string) =>
  text.split("\n").flatMap((line) => /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)?.[1] ?? []);

/** The kind from the first line, plus the problems of that line. */
function headerOf(body: string): { kind: Kind | null; problems: string[] } {
  const first = body.split("\n")[0] ?? "";
  const kind = /^Kind: (\w+)/.exec(first)?.[1] as Kind | undefined;
  if (!kind || !KINDS.includes(kind)) {
    return { kind: null, problems: [`Kind: use one of ${KINDS.join(", ")}`] };
  }
  const problems: string[] = [];
  if (!/· Parent: (#\d+|none)(?= ·|$)/.test(first)) problems.push("Parent: write #N or none");
  if (!/· Budget: \d+ min\s*$/.test(first)) problems.push("Budget: write <N> min");
  return { kind, problems };
}

/** What a present section must hold beyond existing; "" when it holds it. */
function contentProblem(name: string, text: string): string {
  const items = itemsOf(text);
  if (name === "Scenarios" && !items.some((i) => /GIVEN .+ WHEN .+ THEN .+/.test(i))) {
    return 'Scenarios: write at least one "GIVEN … WHEN … THEN …" item';
  }
  if (name === "Tasks" && !items.some((i) => /^\[[ xX]\] /.test(i))) {
    return 'Tasks: write at least one "- [ ]" item';
  }
  if (name === "Done when" && !items.some((i) => /`[^`]+`/.test(i))) {
    return "Done when: name a command that proves it";
  }
  return "";
}

/** The problems of an issue body, one line each; empty when the body is valid. */
export function checkIssue(body: string): string[] {
  const { kind, problems } = headerOf(body);
  if (kind === null) return problems;
  const sections = sectionsOf(body);
  for (const [name, need] of SECTIONS) {
    const text = sections.get(name);
    if (text === undefined) {
      if (need[kind] === "required") problems.push(`${name}: required for ${kind}`);
      continue;
    }
    // A section the kind does not ask for is not checked; an optional one is checked when written.
    if (need[kind] === "no") continue;
    const wrong = contentProblem(name, text);
    if (wrong) problems.push(wrong);
  }
  return problems;
}

/** The value of `--flag <value>`, or null. */
const flag = (args: string[], name: string): string | null => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? null) : null;
};

/** The body of `--body-file`: the text, or the exit code after saying why. */
function bodyFrom(args: string[], deps: IssueDeps): string | number {
  const path = flag(args, "--body-file");
  if (path === null) {
    deps.log("--body-file <md> is required");
    return 2;
  }
  const body = deps.readFile(path);
  if (body === null) {
    deps.log(`cannot read ${path}`);
    return 2;
  }
  return body;
}

/** Prints the problems of a body; true when there are none. */
function accepted(body: string, deps: IssueDeps): boolean {
  const problems = checkIssue(body);
  for (const problem of problems) deps.log(problem);
  return problems.length === 0;
}

/** `gh api` failed: say so, with its first line of error and nothing more. */
function ghFailed(what: string, result: GhResult, deps: IssueDeps): number {
  const detail = (result.stderr ?? "").trim().split("\n")[0] ?? "";
  deps.log(`${what} failed${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  return 1;
}

const ISSUE_NUMBER = /^\d+$/;

/** `check`, `new` or `edit`: the exit code. */
export async function runIssue(args: string[], deps: IssueDeps): Promise<number> {
  const [command, ...rest] = args;
  if (command === "check") {
    const n = rest[0] && ISSUE_NUMBER.test(rest[0]) ? rest[0] : null;
    if (n !== null) {
      const read = await deps.gh(["api", `repos/${REPO}/issues/${n}`, "--jq", ".body"]);
      if (read.code !== 0) return ghFailed(`reading issue ${n}`, read, deps);
      return accepted(read.stdout, deps) ? 0 : 1;
    }
    const body = bodyFrom(rest, deps);
    if (typeof body === "number") return body;
    return accepted(body, deps) ? 0 : 1;
  }
  if (command === "new") {
    const title = flag(rest, "--title");
    if (!title || title.length > 256) {
      deps.log('--title "<t>" is required, at most 256 characters');
      return 2;
    }
    const body = bodyFrom(rest, deps);
    if (typeof body === "number") return body;
    if (!accepted(body, deps)) return 1;
    const made = await deps.gh([
      "api",
      "-X",
      "POST",
      `repos/${REPO}/issues`,
      "-f",
      `title=${title}`,
      "-f",
      `body=${body}`,
      "-f",
      `assignees[]=${ASSIGNEE}`,
      "--jq",
      ".number",
    ]);
    if (made.code !== 0) return ghFailed("creating the issue", made, deps);
    deps.log(made.stdout.trim());
    return 0;
  }
  if (command === "edit") {
    const n = rest[0] && ISSUE_NUMBER.test(rest[0]) ? rest[0] : null;
    if (n === null) {
      deps.log(USAGE);
      return 2;
    }
    const body = bodyFrom(rest, deps);
    if (typeof body === "number") return body;
    if (!accepted(body, deps)) return 1;
    const patched = await deps.gh([
      "api",
      "-X",
      "PATCH",
      `repos/${REPO}/issues/${n}`,
      "-f",
      `body=${body}`,
    ]);
    return patched.code === 0 ? 0 : ghFailed(`editing issue ${n}`, patched, deps);
  }
  deps.log(USAGE);
  return 2;
}
