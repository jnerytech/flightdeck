import { jsonLines } from "./pr-checks.ts";
import { MAIN, type PrFlowDeps, REPO, usage } from "./pr-types.ts";

/*
 * Tagging a release (#1589, from pr-flow.ts): `bun run pr -- tag <vX.Y.Z>` tags a commit of main
 * only after a full green CI run of it, and pushes the tag alone. The coordinator's only.
 */

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
 * The job a dispatched full run must pass: since #296 it merges the six shard jobs into the coverage
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
export async function tagRelease(args: string[], deps: PrFlowDeps): Promise<number> {
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
