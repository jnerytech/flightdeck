import { BRANCH_PR_JQ, branchPr, otherPrsMessage } from "./branch-pr.ts";
import { MAIN, type PrFlowDeps, REPO, usage } from "./pr-types.ts";
import { reviewProblem } from "./review-record.ts";

/*
 * `bun run pr -- open <branch> …` (issues #260, #839, #909, #2442): opens the PR of a branch,
 * titled after its issue, with the issues it closes (or, for a slice, only references) in its body.
 */

/** The issue a branch is about: the one its commit subjects name most, `(#N)`. */
export function issueOf(subjects: string[]): number | null {
  const counts = new Map<number, number>();
  for (const subject of subjects) {
    for (const group of subject.matchAll(/\(([^()]*)\)/g)) {
      for (const m of (group[1] ?? "").matchAll(/#(\d+)/g)) {
        const n = Number(m[1]);
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
  }
  let best: number | null = null;
  for (const [n, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = n;
  return best;
}

/**
 * The issues a branch ships (#2442): every issue its feat and fix subjects name with `(#N)`, once,
 * the oldest commit's first (git lists the newest first). With no feat or fix naming one, the
 * branch's own issue (`issueOf`); none when no subject names an issue.
 */
export function issuesOf(subjects: string[]): number[] {
  const named = new Set<number>();
  for (const subject of [...subjects].reverse()) {
    if (!/^(?:feat|fix)(?:\([^)]*\))?!?:/.test(subject)) continue;
    for (const group of subject.matchAll(/\(([^()]*)\)/g)) {
      for (const m of (group[1] ?? "").matchAll(/#(\d+)/g)) named.add(Number(m[1]));
    }
  }
  if (named.size > 0) return [...named];
  const own = issueOf(subjects);
  return own === null ? [] : [own];
}

/** The numbers of `--issue a,b,c`; null when any part is not an issue number. */
function issueList(value: string): number[] | null {
  const parts = value.split(",");
  if (!parts.every((part) => /^[1-9]\d*$/.test(part))) return null;
  return [...new Set(parts.map(Number))];
}

/**
 * The subjects of the branch's own commits, newest first: its first-parent line, without merge
 * commits, so a merge of main brings none of main's commits into the title, the PR body or the
 * issue (#2157). A stale origin/<base> can still list a direct commit on main's own first-parent
 * line between it and the fork point; pr open does not fetch.
 */
async function ownSubjects(
  branch: string,
  base: string,
  git: PrFlowDeps["git"],
): Promise<string[]> {
  const log = await git([
    "log",
    "--first-parent",
    "--no-merges",
    "--format=%s",
    `origin/${base}..origin/${branch}`,
  ]);
  return log.stdout.split("\n").filter(Boolean);
}

/**
 * The first non-merge commit's subject (git log lists the newest first) without its
 * `type(scope): ` prefix and trailing `(#N)`, or null when the branch has none (#909).
 */
export function sliceTitle(subjects: string[]): string | null {
  const first = subjects.findLast((s) => !s.startsWith("Merge "));
  if (!first) return null;
  const text = first
    .replace(/^[a-z]+(?:\([^)]*\))?!?: /, "")
    .replace(/ \(#\d+\)$/, "")
    .trim();
  return text || null;
}

/** #1246: says a red main and who owns its fix before a PR moves; never blocks, never fails. */
export async function warnMainRed(deps: PrFlowDeps): Promise<void> {
  const line = await deps.mainRed?.().catch(() => null);
  if (line) deps.log(`warning: ${line}`);
}

/** Why `branch` gets no new PR now (the exit code and what to say), or null when it can: not on origin, its PRs unreadable, already open, another branch's, or no review record. */
async function openBlock(
  branch: string,
  base: string,
  deps: PrFlowDeps,
): Promise<{ code: number; message: string } | null> {
  if ((await deps.git(["rev-parse", "--verify", "--quiet", `origin/${branch}`])).code !== 0) {
    return { code: 2, message: `${branch} is not on origin: push it first` };
  }
  const existing = await deps.gh([
    "api",
    `${REPO}/pulls?head={owner}:${branch}&state=open`,
    "--jq",
    BRANCH_PR_JQ,
  ]);
  if (existing.code !== 0) {
    return { code: 1, message: `the open PRs of ${branch} cannot be read: nothing was opened` };
  }
  const { own, others } = branchPr(existing.stdout, branch);
  if (own !== null) return { code: 0, message: `${branch} already has PR #${own}` };
  if (others.length > 0) return { code: 1, message: otherPrsMessage(branch, others) };
  // #1707: a session's PR needs the record of both reviews on its head; the coordinator's rc branch (workers cannot push rc/*) does not.
  const problem = branch.startsWith("rc/") ? null : await reviewProblem(branch, base, deps.git);
  return problem ? { code: 1, message: problem } : null;
}

/** The issues a PR names: the one slice of --refs, the list of --issue, or those the feat and fix subjects name. Null for a malformed --issue list. */
function prIssues(
  mode: { refs: boolean; named: boolean; given: string | undefined },
  subjects: string[],
): number[] | null {
  if (mode.refs) {
    const slice = Number(mode.given) || issueOf(subjects);
    return slice ? [slice] : [];
  }
  return mode.named ? issueList(mode.given ?? "") : issuesOf(subjects);
}

/** The title of each issue in order, or the number of the first one that cannot be read. */
async function issueTitles(issues: number[], deps: PrFlowDeps): Promise<string[] | number> {
  const titles: string[] = [];
  for (const n of issues) {
    const title = await deps.gh(["api", `${REPO}/issues/${n}`, "--jq", ".title"]);
    if (title.code !== 0) return n;
    titles.push(title.stdout.trim());
  }
  return titles;
}

export async function openPr(args: string[], deps: PrFlowDeps): Promise<number> {
  const branch = args[0];
  if (!branch || branch.startsWith("--")) return usage(deps);
  await warnMainRed(deps);
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes("--issue") && args.includes("--refs")) {
    deps.log("--issue and --refs cannot be used together: pick one");
    return 2;
  }
  const base = option("--base") ?? MAIN;
  const blocked = await openBlock(branch, base, deps);
  if (blocked) {
    deps.log(blocked.message);
    return blocked.code;
  }
  const subjects = await ownSubjects(branch, base, deps.git);
  const refs = args.includes("--refs");
  // #2442: --issue a,b,c closes several issues in one PR; without --issue, every issue the feat
  // and fix commits name. --refs is one slice of one issue.
  const given = option(refs ? "--refs" : "--issue");
  if (refs && given?.includes(",")) {
    deps.log("--refs takes one issue: a slice of one issue");
    return 2;
  }
  const issues = prIssues({ refs, named: args.includes("--issue"), given }, subjects);
  if (issues === null) {
    deps.log("--issue takes issue numbers separated by commas: --issue 12,13");
    return 2;
  }
  const [issue] = issues;
  if (!issue) {
    deps.log(`no (#N) in the subjects of ${branch}'s commits: name the issue with --issue <n>`);
    return 2;
  }
  const titles = await issueTitles(issues, deps);
  if (typeof titles === "number") {
    deps.log(`#${titles}: the issue cannot be read`);
    return 1;
  }
  const link = refs ? "Refs" : "Closes";
  // #909: a slice (--refs) is named after its own first commit, not the issue it is part of; a
  // PR that closes its issue keeps the issue's title (the first issue's, for several). --title
  // names it by hand in every mode.
  const name = option("--title") ?? (refs ? sliceTitle(subjects) : null) ?? titles[0];
  const body = [...issues.map((n) => `${link} #${n}`), "", ...subjects.map((s) => `- ${s}`)].join(
    "\n",
  );
  const created = await deps.gh([
    "api",
    "-X",
    "POST",
    `${REPO}/pulls`,
    "-f",
    `title=${name} (#${issue})`,
    "-f",
    `head=${branch}`,
    "-f",
    `base=${base}`,
    "-f",
    `body=${body}`,
    "-F",
    `draft=${args.includes("--draft")}`,
    "--jq",
    String.raw`"\(.number) \(.html_url)"`,
  ]);
  if (created.code !== 0) {
    deps.log(`GitHub refused the PR for ${branch}`);
    return 1;
  }
  deps.log(`#${created.stdout.trim()}`);
  await prOpenedHook(created.stdout.trim().split(" ")[0] ?? "", branch, base, deps);
  return 0;
}

/**
 * The hook's command: a JSON array of strings (a path with spaces, Windows), or words split on
 * spaces. Empty when unset; null when it starts like JSON but is not an array of strings.
 */
function hookCommand(value: string): string[] | null {
  if (!value.startsWith("[")) return value ? value.split(/\s+/) : [];
  try {
    const parsed: unknown = JSON.parse(value);
    const ok =
      Array.isArray(parsed) && parsed.length > 0 && parsed.every((w) => typeof w === "string");
    return ok ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Runs FLIGHTDECK_PR_OPENED (#273), when set, with the new PR's number, branch and base, for the
 * coordinator's tooling. It fails open: the PR is open anyway.
 */
async function prOpenedHook(n: string, branch: string, base: string, deps: PrFlowDeps) {
  const hook = hookCommand(deps.env.FLIGHTDECK_PR_OPENED?.trim() ?? "");
  if (hook === null) {
    deps.log(`FLIGHTDECK_PR_OPENED is not a JSON array of strings; #${n} is open`);
    return;
  }
  if (hook.length === 0 || !deps.run) return;
  let failure: string | null;
  try {
    // Only the exit code: the hook inherits the environment, so what it prints may hold a token.
    const { code } = await deps.run([...hook, n, branch, base]);
    failure = code === 0 ? null : `exit ${code}`;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (failure) deps.log(`FLIGHTDECK_PR_OPENED hook failed (${failure}); #${n} is open`);
}
