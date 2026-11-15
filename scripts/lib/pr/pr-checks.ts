import { MAIN, type PrFlowDeps, REPO } from "./pr-types.ts";

/**
 * What a PR's checks and its base say (#1589): whether the required checks are green on a commit,
 * how far the branch is ahead of or behind its base, and whether it conflicts. Read-only calls to
 * GitHub; `open`, `auto` and `merge` decide from them.
 */

/** A required check passes as GitHub counts it: a success, or a run it skipped or left neutral. */
const PASSED = new Set(["success", "skipped", "neutral"]);

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
export function jsonLines<T>(stdout: string): T[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

export async function requiredChecks(deps: PrFlowDeps): Promise<string[] | null> {
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

export async function checksProblem(
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
export async function aheadBy(
  deps: PrFlowDeps,
  base: string,
  head: string,
): Promise<number | null> {
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
export function conflictText(base: string, head: string): string {
  return `conflicts with ${base}: merge ${base} into ${head} and resolve them`;
}

/** Why a PR cannot merge as it is, from GitHub's mergeable state: a conflict with its base, or null. */
export async function conflictProblem(
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
export async function behindBy(deps: PrFlowDeps, base: string, head: string): Promise<number> {
  const { stdout } = await deps.gh([
    "api",
    `${REPO}/compare/${base}...${head}`,
    "--jq",
    ".behind_by",
  ]);
  return Number(stdout.trim()) || 0;
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
