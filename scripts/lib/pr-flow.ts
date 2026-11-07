import { inSequence } from "@flightdeck/protocol";
/**
 * `bun run pr -- <open|next|update|merge> …` (issue #260, GitHub Flow): one PR per branch to main,
 * each merged on its own when its required checks are green on its HEAD. All of it through REST
 * (`gh api`): `open` titles the PR after the branch's issue and closes it, `next` lists the open PRs
 * in the order to merge them (a stacked PR after its parent) with what each still needs, `update`
 * brings a PR up to date with its base, `auto` (any session, #271) turns on GitHub's auto-merge
 * (or, for a PR already clean and green, merges it as auto-merge would, #374), and `merge` (the
 * coordinator only) merges with a merge commit, never a squash.
 */

export interface GhResult {
  code: number;
  stdout: string;
}

export interface PrFlowDeps {
  /** Runs `gh <args>`; `gh api` fills `{owner}` and `{repo}` from the current repository. */
  gh(args: string[]): Promise<GhResult>;
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GhResult>;
  /** Runs a command (the FLIGHTDECK_PR_OPENED hook, #273); only its exit code is read. */
  run?(command: string[]): Promise<GhResult>;
  env: Record<string, string | undefined>;
  log(line: string): void;
}

export interface Pr {
  number: number;
  head: string;
  sha: string;
  base: string;
  draft: boolean;
  title: string;
}

const REPO = "repos/{owner}/{repo}";
const MAIN = "main";
const USAGE =
  "usage: bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n>] | next | update <n> | auto <n> | merge <n> | tag <vX.Y.Z> [--commit <sha>]";
/** A required check passes as GitHub counts it: a success, or a run it skipped or left neutral. */
const PASSED = new Set(["success", "skipped", "neutral"]);

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

/** The order to merge: PRs onto main by number, each stacked PR right after the PR it sits on. */
export function mergeOrder(prs: Pr[]): Pr[] {
  const byNumber = [...prs].sort((a, b) => a.number - b.number);
  const heads = new Set(prs.map((p) => p.head));
  const order: Pr[] = [];
  const visit = (pr: Pr) => {
    order.push(pr);
    for (const child of byNumber.filter((p) => p.base === pr.head)) visit(child);
  };
  for (const root of byNumber.filter((p) => !heads.has(p.base))) visit(root);
  return order;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

/** A commit status as a check's state: success is ok, pending waits, anything else fails. */
function statusState(status: string): "ok" | "failing" | "pending" {
  if (status === "success") return "ok";
  return status === "pending" ? "pending" : "failing";
}

/** Whether every required check is green: the newest run of each name, or a commit status. */
export function checksVerdict(
  required: string[],
  runs: CheckRun[],
  statuses: { context: string; state: string }[],
): { green: boolean; failing: string[]; pending: string[]; missing: string[] } {
  const verdict = {
    green: true,
    failing: [] as string[],
    pending: [] as string[],
    missing: [] as string[],
  };
  for (const name of required) {
    const run = runs.filter((r) => r.name === name).sort((a, b) => b.id - a.id)[0];
    const status = statuses.find((s) => s.context === name)?.state;
    let state: "ok" | "failing" | "pending" | "missing";
    if (run) {
      if (run.status !== "completed") state = "pending";
      else state = PASSED.has(run.conclusion ?? "") ? "ok" : "failing";
    } else if (status) {
      state = statusState(status);
    } else state = "missing";
    if (state !== "ok") {
      verdict.green = false;
      verdict[state].push(name);
    }
  }
  return verdict;
}

/** The JSON values gh printed one per line (`--jq` with an object per result). */
function jsonLines<T>(stdout: string): T[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

async function requiredChecks(deps: PrFlowDeps): Promise<string[] | null> {
  const { code, stdout } = await deps.gh(["api", `${REPO}/rules/branches/${MAIN}`]);
  if (code !== 0) return null;
  const rules = JSON.parse(stdout) as {
    type: string;
    parameters?: { required_status_checks?: { context: string }[] };
  }[];
  const checks = rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c.context);
  return checks.length > 0 ? checks : null;
}

/** What the PR's checks still need ("failing: …; running: …"), or null when they are green. */
/** The verdict of a commit's required checks, from its check runs and commit statuses. */
async function verdictOf(deps: PrFlowDeps, sha: string, required: string[]) {
  const runs = await deps.gh([
    "api",
    "--paginate",
    `${REPO}/commits/${sha}/check-runs?per_page=100`,
    "--jq",
    ".check_runs[] | {id, name, status, conclusion}",
  ]);
  const statuses = await deps.gh([
    "api",
    `${REPO}/commits/${sha}/status`,
    "--jq",
    ".statuses[] | {context, state}",
  ]);
  return checksVerdict(required, jsonLines(runs.stdout), jsonLines(statuses.stdout));
}

async function checksProblem(
  deps: PrFlowDeps,
  sha: string,
  required: string[],
): Promise<string | null> {
  const v = await verdictOf(deps, sha, required);
  if (v.green) return null;
  return [
    v.failing.length > 0 ? `failing: ${v.failing.join(", ")}` : "",
    v.pending.length > 0 ? `running: ${v.pending.join(", ")}` : "",
    v.missing.length > 0 ? `missing: ${v.missing.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** How many commits `head` has that `base` does not (0: base has all of it); null when unknown. */
async function aheadBy(deps: PrFlowDeps, base: string, head: string): Promise<number | null> {
  const { code, stdout } = await deps.gh([
    "api",
    `${REPO}/compare/${base}...${head}`,
    "--jq",
    ".ahead_by",
  ]);
  const ahead = Number.parseInt(stdout.trim(), 10);
  return code === 0 && Number.isInteger(ahead) ? ahead : null;
}

/** What a PR that conflicts with its base needs: GitHub's update-branch cannot resolve it. */
function conflictText(base: string, head: string): string {
  return `conflicts with ${base}: merge ${base} into ${head} and resolve them`;
}

/** Why a PR cannot merge as it is, from GitHub's mergeable state: a conflict with its base, or null. */
async function conflictProblem(
  deps: PrFlowDeps,
  n: number,
  base: string,
  head: string,
): Promise<string | null> {
  const { code, stdout } = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  if (code !== 0) return null;
  const state = (JSON.parse(stdout) as { mergeable_state?: string }).mergeable_state;
  return state === "dirty" ? conflictText(base, head) : null;
}

/** How many commits of its base the PR's branch does not have. */
async function behindBy(deps: PrFlowDeps, base: string, head: string): Promise<number> {
  const { stdout } = await deps.gh([
    "api",
    `${REPO}/compare/${base}...${head}`,
    "--jq",
    ".behind_by",
  ]);
  return Number(stdout.trim()) || 0;
}

async function openPr(args: string[], deps: PrFlowDeps): Promise<number> {
  const branch = args[0];
  if (!branch || branch.startsWith("--")) return usage(deps);
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const base = option("--base") ?? MAIN;
  if ((await deps.git(["rev-parse", "--verify", "--quiet", `origin/${branch}`])).code !== 0) {
    deps.log(`${branch} is not on origin: push it first`);
    return 2;
  }
  const existing = await deps.gh([
    "api",
    `${REPO}/pulls?head={owner}:${branch}&state=open`,
    "--jq",
    ".[].number",
  ]);
  const open = existing.stdout.trim().split("\n")[0];
  if (open) {
    deps.log(`${branch} already has PR #${open}`);
    return 0;
  }
  const log = await deps.git(["log", "--format=%s", `origin/${base}..origin/${branch}`]);
  const subjects = log.stdout.split("\n").filter(Boolean);
  const issue = Number(option("--issue")) || issueOf(subjects);
  if (!issue) {
    deps.log(`no (#N) in the subjects of ${branch}'s commits: name the issue with --issue <n>`);
    return 2;
  }
  const title = await deps.gh(["api", `${REPO}/issues/${issue}`, "--jq", ".title"]);
  if (title.code !== 0) {
    deps.log(`#${issue}: the issue cannot be read`);
    return 1;
  }
  const body = [`Closes #${issue}`, "", ...subjects.map((s) => `- ${s}`)].join("\n");
  const created = await deps.gh([
    "api",
    "-X",
    "POST",
    `${REPO}/pulls`,
    "-f",
    `title=${title.stdout.trim()} (#${issue})`,
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
 * Runs FLIGHTDECK_PR_OPENED (#273), when set, with the new PR's number, branch and base: the
 * coordinator's tooling queues an OpenCode review there. It fails open: the PR is open anyway.
 */
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

async function nextPrs(deps: PrFlowDeps): Promise<number> {
  const required = await requiredChecks(deps);
  if (!required) {
    deps.log(`the ${MAIN} ruleset's required checks cannot be read`);
    return 1;
  }
  const listed = await deps.gh([
    "api",
    "--paginate",
    `${REPO}/pulls?state=open&per_page=100`,
    "--jq",
    ".[] | {number, head: .head.ref, sha: .head.sha, base: .base.ref, draft, title}",
  ]);
  const prs = jsonLines<Pr>(listed.stdout);
  if (prs.length === 0) {
    deps.log("no open PR");
    return 0;
  }
  const ready: string[] = [];
  const waiting: string[] = [];
  await inSequence(mergeOrder(prs), async (pr) => {
    const parent = prs.find((p) => p.head === pr.base);
    let reason: string | null = null;
    if (parent) reason = `waits for #${parent.number} (${parent.head})`;
    else if (pr.draft) reason = "a draft";
    else reason = await checksProblem(deps, pr.sha, required);
    // Behind its base is no reason to wait (the ruleset is not strict, #305); a conflict is.
    if (!reason) reason = await conflictProblem(deps, pr.number, pr.base, pr.head);
    if (reason) waiting.push(`  #${pr.number} ${pr.head}: ${reason}`);
    else ready.push(`  #${pr.number} ${pr.head}`);
  });
  if (ready.length > 0) deps.log("ready to merge, in order:");
  for (const line of ready) deps.log(line);
  if (waiting.length > 0) deps.log("not ready:");
  for (const line of waiting) deps.log(line);
  return 0;
}

/**
 * Brings a PR up to date with its base, then turns its auto-merge back on (#613): GitHub turns it
 * off when the PR conflicts, and nothing turned it back on after the merge. A draft, or a PR onto a
 * parent main does not have yet, stays updated without it, which is no failure.
 */
async function updatePr(n: number, deps: PrFlowDeps): Promise<number> {
  const { code } = await deps.gh(["api", "-X", "PUT", `${REPO}/pulls/${n}/update-branch`]);
  deps.log(code === 0 ? `#${n} updated with its base` : `GitHub refused to update #${n}`);
  if (code !== 0) return 1;
  return (await autoPr(n, deps)) === 1 ? 1 : 0;
}

/** Turns on GitHub's auto-merge for a PR onto main: it merges by itself once its checks are green. */
async function autoPr(n: number, deps: PrFlowDeps): Promise<number> {
  const read = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  if (read.code !== 0) {
    deps.log(`#${n} cannot be read`);
    return 1;
  }
  const pr = JSON.parse(read.stdout) as { node_id: string; draft: boolean; base: { ref: string } };
  let reason: string | null = null;
  if (pr.draft) reason = "a draft: mark it ready first";
  else if (pr.base.ref !== MAIN) {
    const ahead = await aheadBy(deps, MAIN, pr.base.ref);
    if (ahead === null) reason = `GitHub cannot compare ${pr.base.ref} with ${MAIN}`;
    else if (ahead > 0) {
      reason = `onto ${pr.base.ref}, which ${MAIN} does not have yet: run it again once its parent merges`;
    }
  }
  if (reason) {
    deps.log(`#${n}: auto-merge not turned on: ${reason}`);
    return 2;
  }
  // The parent merged and its branch stays (no delete on merge): the PR goes onto main itself.
  if (pr.base.ref !== MAIN) {
    const moved = await deps.gh(["api", "-X", "PATCH", `${REPO}/pulls/${n}`, "-f", `base=${MAIN}`]);
    if (moved.code !== 0) {
      deps.log(`GitHub refused to retarget #${n} onto ${MAIN}`);
      return 1;
    }
    deps.log(`#${n} retargeted from ${pr.base.ref} onto ${MAIN}`);
  }
  const enabled = await deps.gh([
    "api",
    "-X",
    "POST",
    "graphql",
    "-f",
    "query=mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }",
    "-f",
    `id=${pr.node_id}`,
  ]);
  if (enabled.code !== 0) {
    const error = graphqlError(enabled.stdout);
    deps.log(`GitHub refused auto-merge for #${n}${error}`);
    // GitHub turns auto-merge on only for a PR that has to wait (#374): one already clean merges
    // now, as auto-merge would, under the same checks; any other refusal stays a failure.
    if (/clean status/i.test(error)) {
      deps.log(`#${n} is already mergeable: merging it as auto-merge would`);
      return mergeChecked(n, deps, true);
    }
    return 1;
  }
  deps.log(`#${n} merges by itself, with a merge commit, once its required checks are green`);
  return 0;
}

/** The first error GitHub's GraphQL gave, as ": <message>", or nothing. */
function graphqlError(stdout: string): string {
  try {
    const message = (JSON.parse(stdout) as { errors?: { message?: string }[] }).errors?.[0]
      ?.message;
    return message ? `: ${message}` : "";
  } catch {
    return "";
  }
}

async function mergePr(n: number, deps: PrFlowDeps): Promise<number> {
  if (deps.env.FLIGHTDECK_COORDINATOR !== "1") {
    deps.log("merging is the coordinator's (FLIGHTDECK_COORDINATOR=1)");
    return 2;
  }
  return mergeChecked(n, deps, false);
}

/**
 * Merges a PR onto main with a merge commit, pinned to the head whose checks were read, only when
 * every required check of the ruleset is green there. `cleanOnly` (`auto`, #374) also needs GitHub's
 * state to be exactly clean, the state auto-merge waits for; a hand merge lets a PR behind main
 * through (#305).
 */
async function mergeChecked(n: number, deps: PrFlowDeps, cleanOnly: boolean): Promise<number> {
  const required = await requiredChecks(deps);
  if (!required) {
    deps.log(`the ${MAIN} ruleset's required checks cannot be read`);
    return 1;
  }
  const read = await deps.gh(["api", `${REPO}/pulls/${n}`]);
  if (read.code !== 0) {
    deps.log(`#${n} cannot be read`);
    return 1;
  }
  const pr = JSON.parse(read.stdout) as {
    draft: boolean;
    head: { ref: string; sha: string };
    base: { ref: string };
    mergeable_state?: string;
  };
  let reason: string | null = null;
  if (pr.draft) reason = "a draft";
  else if (pr.base.ref !== MAIN)
    reason = `onto ${pr.base.ref}, not ${MAIN}: merge its parent first`;
  else reason = await checksProblem(deps, pr.head.sha, required);
  const state = pr.mergeable_state ?? "unknown";
  if (!reason && cleanOnly && state !== "clean") {
    reason = `GitHub says ${state}, not clean: run bun run pr -- auto ${n} again`;
  }
  if (!reason && state === "dirty") reason = conflictText(MAIN, pr.head.ref);
  if (reason) {
    deps.log(`#${n} not merged: ${reason}`);
    return 2;
  }
  // Behind main merges (#305): a note for a hand merge; main's push CI checks the result.
  const behind = await behindBy(deps, MAIN, pr.head.ref);
  if (behind > 0) {
    deps.log(
      `#${n} is ${behind} commit(s) behind ${MAIN} (merged anyway; ${MAIN}'s push CI runs on the result)`,
    );
  }
  const merged = await deps.gh([
    "api",
    "-X",
    "PUT",
    `${REPO}/pulls/${n}/merge`,
    "-f",
    "merge_method=merge",
    "-f",
    `sha=${pr.head.sha}`,
  ]);
  deps.log(merged.code === 0 ? `#${n} merged into ${MAIN}` : `GitHub refused to merge #${n}`);
  return merged.code === 0 ? 0 : 1;
}

function usage(deps: PrFlowDeps): number {
  deps.log(USAGE);
  return 2;
}

/** The CI of a commit, by the main ruleset's required checks: "0", "failed", "pending", "none" or "unknown" (#266). */
export async function headCi(sha: string, deps: PrFlowDeps): Promise<string> {
  const required = await requiredChecks(deps);
  if (!required) return "unknown";
  const v = await verdictOf(deps, sha, required);
  if (v.green) return "0";
  if (v.failing.length > 0) return "failed";
  // Nothing reported yet for any required check: the commit was never run (not pushed, or no PR).
  return v.missing.length === required.length ? "none" : "pending";
}

/** The file that holds the product version: the root package.json has none (the apps and the protocol share it, a test checks). */
export const VERSION_FILE = "apps/desktop/package.json";

const TAG = /^v\d+\.\d+\.\d+(?:-[\w.]+)?$/;

type MainRun = { id?: number; event?: string; status: string; conclusion: string | null };

/** A run that finished and did not pass: a cancelled or skipped one (a later merge replaced it) did not fail. */
function runFailed(run: MainRun): boolean {
  return (
    run.status === "completed" &&
    !["success", "cancelled", "skipped"].includes(run.conclusion ?? "")
  );
}

/**
 * The job a dispatched full run must pass: since #296 it merges the six shard jobs into the 100%
 * gate, and fails closed when one is missing (ci-shards.test.ts pins the pairing).
 */
export const FULL_SUITE_JOB = "test suite (ubuntu-latest)";

/** Every CI run of a commit on main, of any event: a push's, the schedule's, a dispatch's. */
async function mainRuns(sha: string, deps: PrFlowDeps): Promise<MainRun[]> {
  const listed = await deps.gh([
    "api",
    `${REPO}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=${MAIN}`,
    "--jq",
    ".workflow_runs[] | {id, event, status, conclusion}",
  ]);
  return jsonLines<MainRun>(listed.stdout);
}

/**
 * Whether one of the runs is a full green run (#444): the schedule's (every 3 hours), or a dispatch
 * whose test suite ran and passed (a screenshots-only dispatch skips it). A push to main runs only
 * the related selection, so its green is not enough for a release.
 */
async function fullGreen(runs: MainRun[], deps: PrFlowDeps): Promise<boolean> {
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion !== "success") continue;
    if (run.event === "schedule") return true;
    if (run.event !== "workflow_dispatch" || run.id === undefined) continue;
    const jobs = await deps.gh([
      "api",
      `${REPO}/actions/runs/${run.id}/jobs?per_page=100`,
      "--jq",
      ".jobs[] | {name, conclusion}",
    ]);
    const list = jsonLines<{ name: string; conclusion: string | null }>(jobs.stdout);
    if (list.some((j) => j.name.startsWith(FULL_SUITE_JOB) && j.conclusion === "success")) {
      return true;
    }
  }
  return false;
}

function refuseRuns(sha: string, runs: MainRun[], refuse: (reason: string) => number): number {
  if (runs.length === 0) {
    return refuse(
      `no full green run of ${sha} on ${MAIN}: the schedule runs one every 3 hours, or start one (gh workflow run ci.yml --ref ${MAIN} -f only=all)`,
    );
  }
  // A failure is said before "still running": a failed run settles it whatever else is going.
  if (runs.some(runFailed)) return refuse(`${sha}'s CI run on ${MAIN} did not pass`);
  if (runs.some((r) => r.status !== "completed"))
    return refuse(`${sha}'s CI run on ${MAIN} is still running`);
  return refuse(
    `${sha} has no full green run on ${MAIN}: the schedule runs one every 3 hours, or start one (gh workflow run ci.yml --ref ${MAIN} -f only=all)`,
  );
}

/** Asks for a full run of main unless a dispatch of this commit is already going; says what happened and how to go on. */
async function startFullRun(runs: MainRun[], deps: PrFlowDeps): Promise<string> {
  if (runs.some((r) => r.event === "workflow_dispatch" && r.status !== "completed")) {
    return `a full run of ${MAIN} is already going; run pr tag again when it is green`;
  }
  const started = await deps.gh(["workflow", "run", "ci.yml", "--ref", MAIN, "-f", "only=all"]);
  return started.code === 0
    ? `a full run of ${MAIN} was started; run pr tag again when it is green`
    : `start one (gh workflow run ci.yml --ref ${MAIN} -f only=all)`;
}

/** The newest first-parent commit of main whose package.json says the tag's version and that has a green run. */
async function greenWithBump(tag: string, deps: PrFlowDeps): Promise<string | null> {
  const listed = await deps.git(["rev-list", "--first-parent", "-n", "30", `origin/${MAIN}`]);
  for (const sha of listed.stdout.split("\n").filter(Boolean)) {
    const shown = await deps.git(["show", `${sha}:${VERSION_FILE}`]);
    let version: unknown;
    try {
      version = (JSON.parse(shown.stdout) as { version?: unknown }).version;
    } catch {
      version = undefined;
    }
    if (version !== tag.slice(1)) return null;
    if (await fullGreen(await mainRuns(sha, deps), deps)) return sha;
  }
  return null;
}

/**
 * What to tag when the commit asked for (main's HEAD by default) has no full green run: an earlier
 * commit of main, or the exit code of a refusal (said by `refuse`).
 */
async function earlierTarget(
  want: { tag: string; sha: string; runs: MainRun[]; pinned: boolean },
  refuse: (reason: string) => number,
  deps: PrFlowDeps,
): Promise<string | number> {
  const { tag, sha, runs } = want;
  // A run that failed is never skipped over; --commit asks for exactly that commit.
  if (runs.some(runFailed) || want.pinned) return refuseRuns(sha, runs, refuse);
  // A run that is queued or going has not failed (on a busy main it is HEAD's usual state, #529).
  const running = runs.some((r) => r.status !== "completed");
  // Without --commit, the newest commit that has the bump and a full green run is the release
  // (#376, #444); with none, a full run of main starts, and pr tag runs again when it is green.
  const earlier = await greenWithBump(tag, deps);
  if (!earlier) {
    // A full run starts at once, even while HEAD's push run is going: dispatches have their own concurrency group (#545).
    const next = await startFullRun(runs, deps);
    return refuse(
      running
        ? `${sha}'s CI run on ${MAIN} is still running, and no commit with the ${tag} bump has a full green run: ${next}`
        : `${sha} has no full green run on ${MAIN}, and no commit with the ${tag} bump has one: ${next}`,
    );
  }
  const why = running
    ? `${sha}'s CI run on ${MAIN} is still running`
    : `${sha} has no full green run on ${MAIN}`;
  deps.log(`${why}: tagging ${earlier}, the newest commit with the ${tag} bump that has one`);
  return earlier;
}

/**
 * Tags a commit of main (main's HEAD by default) as a release, only after a green full CI run of it
 * on main (its push), and pushes the tag alone as refs/tags/<tag>: a push of several tags starts no
 * workflow. The coordinator's only.
 */
async function tagRelease(args: string[], deps: PrFlowDeps): Promise<number> {
  const tag = args[0] ?? "";
  if (!TAG.test(tag)) return usage(deps);
  if (deps.env.FLIGHTDECK_COORDINATOR !== "1") {
    deps.log("tagging a release is the coordinator's (FLIGHTDECK_COORDINATOR=1)");
    return 2;
  }
  const refuse = (reason: string) => {
    deps.log(`${tag} not tagged: ${reason}`);
    return 2;
  };
  const head = await deps.git(["rev-parse", `origin/${MAIN}`]);
  const sha = args.includes("--commit")
    ? (args[args.indexOf("--commit") + 1] ?? "")
    : head.stdout.trim();
  if (head.code !== 0 || !sha) return refuse(`origin/${MAIN} cannot be read (git fetch first)`);
  if ((await deps.git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`])).code === 0) {
    return refuse(`${tag} exists already`);
  }
  if ((await deps.git(["merge-base", "--is-ancestor", sha, `origin/${MAIN}`])).code !== 0) {
    return refuse(`${sha} is not on ${MAIN}`);
  }
  const runs = await mainRuns(sha, deps);
  let target = sha;
  if (!(await fullGreen(runs, deps))) {
    const pinned = args.includes("--commit");
    const fallback = await earlierTarget({ tag, sha, runs, pinned }, refuse, deps);
    if (typeof fallback === "number") return fallback;
    target = fallback;
  }
  if ((await deps.git(["tag", "-a", tag, "-m", tag, target])).code !== 0) {
    deps.log(`git refused to make ${tag}`);
    return 1;
  }
  if ((await deps.git(["push", "origin", `refs/tags/${tag}`])).code !== 0) {
    deps.log(`the push of ${tag} failed: the tag is local only (git push origin refs/tags/${tag})`);
    return 1;
  }
  deps.log(`${tag} tagged on ${target} and pushed alone`);
  return 0;
}

/** Runs one command; the exit code (2 for a usage error or a refusal). */
export async function prFlow(argv: string[], deps: PrFlowDeps): Promise<number> {
  const [command, ...args] = argv;
  const n = Number(args[0]);
  if (command === "open") return await openPr(args, deps);
  if (command === "next") return await nextPrs(deps);
  if (command === "update" && Number.isInteger(n) && n > 0) return await updatePr(n, deps);
  if (command === "merge" && Number.isInteger(n) && n > 0) return await mergePr(n, deps);
  if (command === "auto" && Number.isInteger(n) && n > 0) return await autoPr(n, deps);
  if (command === "tag") return await tagRelease(args, deps);
  return usage(deps);
}
