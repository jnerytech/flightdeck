/**
 * `bun run pr -- <open|next|update|merge> …` (issue #260, GitHub Flow): one PR per branch to main,
 * each merged on its own when its required checks are green on its HEAD. All of it through REST
 * (`gh api`): `open` titles the PR after the branch's issue and closes it, `next` lists the open PRs
 * in the order to merge them (a stacked PR after its parent) with what each still needs, `update`
 * brings a PR up to date with its base, `auto` (any session, #271) turns on GitHub's auto-merge,
 * and `merge` (the coordinator only) merges with a merge commit, never a squash.
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
  "usage: bun run pr -- open <branch> [--base <branch>] [--draft] [--issue <n>] | next | update <n> | auto <n> | merge <n>";
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
      state = status === "success" ? "ok" : status === "pending" ? "pending" : "failing";
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
async function checksProblem(
  deps: PrFlowDeps,
  sha: string,
  required: string[],
): Promise<string | null> {
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
  const v = checksVerdict(required, jsonLines(runs.stdout), jsonLines(statuses.stdout));
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
    '"\\(.number) \\(.html_url)"',
  ]);
  if (created.code !== 0) {
    deps.log(`GitHub refused the PR for ${branch}`);
    return 1;
  }
  deps.log(`#${created.stdout.trim()}`);
  return 0;
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
  for (const pr of mergeOrder(prs)) {
    const parent = prs.find((p) => p.head === pr.base);
    let reason: string | null = null;
    if (parent) reason = `waits for #${parent.number} (${parent.head})`;
    else if (pr.draft) reason = "a draft";
    else reason = await checksProblem(deps, pr.sha, required);
    if (!reason) {
      const behind = await behindBy(deps, pr.base, pr.head);
      if (behind > 0) {
        reason = `${behind} commit(s) behind ${pr.base} (bun run pr -- update ${pr.number})`;
      }
    }
    if (reason) waiting.push(`  #${pr.number} ${pr.head}: ${reason}`);
    else ready.push(`  #${pr.number} ${pr.head}`);
  }
  if (ready.length > 0) deps.log("ready to merge, in order:");
  for (const line of ready) deps.log(line);
  if (waiting.length > 0) deps.log("not ready:");
  for (const line of waiting) deps.log(line);
  return 0;
}

async function updatePr(n: number, deps: PrFlowDeps): Promise<number> {
  const { code } = await deps.gh(["api", "-X", "PUT", `${REPO}/pulls/${n}/update-branch`]);
  deps.log(code === 0 ? `#${n} updated with its base` : `GitHub refused to update #${n}`);
  return code === 0 ? 0 : 1;
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
    // GitHub turns auto-merge on only for a PR that has to wait; a session never merges by hand.
    if (/clean status/i.test(error)) {
      deps.log(`#${n} is already mergeable: the coordinator merges it (bun run pr -- merge ${n})`);
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
  };
  let reason: string | null = null;
  if (pr.draft) reason = "a draft";
  else if (pr.base.ref !== MAIN)
    reason = `onto ${pr.base.ref}, not ${MAIN}: merge its parent first`;
  else reason = await checksProblem(deps, pr.head.sha, required);
  if (!reason) {
    const behind = await behindBy(deps, MAIN, pr.head.ref);
    if (behind > 0) reason = `${behind} commit(s) behind ${MAIN}: bun run pr -- update ${n}`;
  }
  if (reason) {
    deps.log(`#${n} not merged: ${reason}`);
    return 2;
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

/** Runs one command; the exit code (2 for a usage error or a refusal). */
export async function prFlow(argv: string[], deps: PrFlowDeps): Promise<number> {
  const [command, ...args] = argv;
  const n = Number(args[0]);
  if (command === "open") return await openPr(args, deps);
  if (command === "next") return await nextPrs(deps);
  if (command === "update" && Number.isInteger(n) && n > 0) return await updatePr(n, deps);
  if (command === "merge" && Number.isInteger(n) && n > 0) return await mergePr(n, deps);
  if (command === "auto" && Number.isInteger(n) && n > 0) return await autoPr(n, deps);
  return usage(deps);
}
