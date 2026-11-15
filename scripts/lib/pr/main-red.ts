/**
 * Issue #1246: a red main is claimed once, and every session sees the claim before fixing it.
 * `bun run main-red` reads main's latest finished CI run, its latest full run (#1381: the push
 * runs test only what changed) and the open `main-red` issues; `claim`
 * opens one issue per red, refused when another owner already claimed one of its failing tests.
 * The SessionStart hook and `bun run pr -- open/update` print the one-line warning.
 */
import type { GhResult } from "../ci/branch.ts";
import {
  type Claim,
  claimBody,
  claimOf,
  current,
  endedRuns,
  failedNames,
  failingOf,
  fullGreenLine,
  fullRunOf,
  fullRunRed,
  holder,
  isFullDispatch,
  type Job,
  latestOfFull,
  type MainRun,
  newerDispatches,
  newestGreenAt,
  oneLine,
  owned,
  parsed,
  plainOwner,
  pushRunOf,
  RERUN,
  type RunRow,
  redHeadline,
  redOf,
  warningLine,
} from "./main-red-rules.ts";

export type { Claim, MainRun } from "./main-red-rules.ts";

export interface MainRedDeps {
  /** Runs `gh <args>` in the repository; stderr is how a missing label is told apart. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
  /** The clock, for a full run's age (#1381); `Date.now` by default. */
  now?: () => number;
}

const LABEL = "main-red";
const USAGE = 'usage: bun run main-red [-- claim "<cause>" [--by <name>]]';

/** Main's latest CI run that finished green or red, or null when there is none or gh failed. */
export async function latestMainRun(deps: Pick<MainRedDeps, "gh">): Promise<MainRun | null> {
  const listed = await deps.gh([
    "run",
    "list",
    "--branch",
    "main",
    "--workflow",
    "CI",
    // #1381: push runs only; the full runs (schedule, dispatch) are read by latestFullRun.
    "--event",
    "push",
    "--status",
    "completed",
    "--limit",
    "10",
    "--json",
    "databaseId,conclusion,createdAt,url",
  ]);
  const runs = listed.code === 0 ? parsed(listed.stdout) : null;
  if (!Array.isArray(runs)) return null;
  return pushRunOf(runs as RunRow[]);
}

/**
 * #1381: main's latest full run (the schedule, or a dispatch with only=all), red only when a job
 * other than Windows failed; null when there is none or gh failed.
 */
export async function latestFullRun(deps: Pick<MainRedDeps, "gh">): Promise<MainRun | null> {
  // Throws when gh cannot list the full runs: the caller tells unread from none.
  // A run on main ran on one of main's commits, and main is never rewritten: it stays in history.
  // Read at once: the SessionStart hook gives the whole lookup 6 seconds.
  const [scheduled, dispatched] = await Promise.all([
    finishedOn(deps, "schedule", 3),
    finishedOn(deps, "workflow_dispatch", 5),
  ]);
  // A dispatch with only=screenshots runs no test suite: only one that did is a full run.
  const newer = newerDispatches(scheduled, dispatched);
  const jobsOf = new Map(
    await Promise.all(
      newer.map(async (r) => [r.databaseId, await runJobs(deps, r.databaseId)] as const),
    ),
  );
  const fullDispatch = newer.find((r) => isFullDispatch(jobsOf.get(r.databaseId)));
  const full = latestOfFull(scheduled[0], fullDispatch);
  if (!full) return null;
  // A green run needs no jobs.
  let red = false;
  if (full.conclusion !== "success") {
    const jobs = jobsOf.has(full.databaseId)
      ? (jobsOf.get(full.databaseId) ?? null)
      : await runJobs(deps, full.databaseId);
    red = fullRunRed(full.conclusion, jobs);
  }
  return fullRunOf(full, red, scheduled, fullDispatch);
}

/** Main's latest CI runs of one event that finished green or red, newest first. */
async function finishedOn(
  deps: Pick<MainRedDeps, "gh">,
  event: string,
  limit: number,
): Promise<RunRow[]> {
  const listed = await deps.gh([
    "run",
    "list",
    "--branch",
    "main",
    "--workflow",
    "CI",
    "--event",
    event,
    "--status",
    "completed",
    "--limit",
    String(limit),
    "--json",
    "databaseId,conclusion,createdAt,url",
  ]);
  const runs = listed.code === 0 ? parsed(listed.stdout) : null;
  // Unread is not none: with no full run known, a green push run would close a claim (#1381).
  if (!Array.isArray(runs)) throw new Error(`gh could not list main's ${event} runs`);
  return endedRuns(runs as RunRow[]);
}

/** A run's jobs, or null when gh cannot say. */
async function runJobs(deps: Pick<MainRedDeps, "gh">, id: number): Promise<Job[] | null> {
  const viewed = await deps.gh(["run", "view", String(id), "--json", "jobs"]);
  const answer = viewed.code === 0 ? parsed(viewed.stdout) : null;
  const jobs = (answer as { jobs?: unknown } | null)?.jobs;
  return Array.isArray(jobs) ? (jobs as Job[]) : null;
}

/** `deps` whose `run view <id> --json jobs` asks GitHub once per call of the tool. */
function jobsOnce<D extends Pick<MainRedDeps, "gh">>(deps: D): D {
  const seen = new Map<string, ReturnType<MainRedDeps["gh"]>>();
  return {
    ...deps,
    gh: (args: string[]) => {
      if (args[0] !== "run" || args[1] !== "view" || !args.includes("jobs")) return deps.gh(args);
      const key = args.join(" ");
      const asked = seen.get(key) ?? deps.gh(args);
      seen.set(key, asked);
      return asked;
    },
  };
}

/**
 * Main's push run and its full run, read at once, and which of them makes main red (the push run
 * first). A full run's red stays until a newer full run is green (up to the 3 hours of the
 * schedule): a later green push run tests only what its merge changed, so it does not clear it.
 */
async function mainState(deps: Pick<MainRedDeps, "gh">) {
  let fullUnread = false;
  const [push, full] = await Promise.all([
    latestMainRun(deps),
    latestFullRun(deps).catch(() => {
      fullUnread = true;
      return null;
    }),
  ]);
  return { push, full, red: redOf(push, full), fullUnread };
}

/** The open `main-red` issues; throws when gh cannot list them (a claim must never be missed). */
export async function openClaims(deps: Pick<MainRedDeps, "gh">): Promise<Claim[]> {
  const listed = await deps.gh([
    "issue",
    "list",
    "--label",
    LABEL,
    "--state",
    "open",
    "--json",
    "number,title,body",
  ]);
  if (listed.code !== 0) throw new Error(`gh issue list failed: ${listed.stderr?.trim() ?? ""}`);
  const issues = parsed(listed.stdout);
  if (!Array.isArray(issues)) throw new Error("gh issue list did not answer with JSON");
  return (issues as Array<{ number: number; title: string; body: string }>).map(claimOf);
}

/** The failed jobs of a run, Windows left out (a signal that gates nothing, #534). */
async function failedJobs(deps: Pick<MainRedDeps, "gh">, run: MainRun): Promise<string[]> {
  return failedNames((await runJobs(deps, run.id)) ?? []);
}

/** The failing tests of a red run (its `(fail)` lines), else its failed jobs as `job: <name>`. */
async function failingTests(
  deps: Pick<MainRedDeps, "gh">,
  run: MainRun,
  jobs: string[],
): Promise<string[]> {
  const log = await deps.gh(["run", "view", String(run.id), "--log-failed"]);
  return failingOf(log.code === 0 ? log.stdout : "", jobs);
}

/** The one-line warning while main is red, or null when it is green or GitHub cannot say. */
export async function mainRedLine(deps: Pick<MainRedDeps, "gh" | "now">): Promise<string | null> {
  try {
    deps = jobsOnce(deps);
    // Asked together: the hook's deadline, not GitHub, is what would hide a red.
    const [state, open] = await Promise.all([mainState(deps), openClaims(deps)]);
    const run = state.red;
    if (!run) return null;
    const claims = current(open, run);
    // With no claim the jobs are not asked for.
    const jobs = claims.length === 0 ? [] : await failedJobs(deps, run);
    return warningLine(run, claims, jobs, (deps.now ?? Date.now)());
  } catch {
    return null;
  }
}

/** The warning line within `ms`, else null: a hook or a PR never waits on GitHub for long. */
export async function mainRedWithin(
  deps: Pick<MainRedDeps, "gh">,
  ms: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // timing: the deadline is the point; a slow GitHub gives no line rather than a late one.
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([mainRedLine(deps), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Prints a red main: the run, what fails, how a full run's red clears, and the claims. */
async function reportRed(
  deps: MainRedDeps,
  state: { red: MainRun; push: MainRun | null; full: MainRun | null },
  claims: Claim[],
  now: number,
): Promise<void> {
  const { red, push, full } = state;
  deps.log(redHeadline(red, push, now));
  for (const name of await failingTests(deps, red, await failedJobs(deps, red))) {
    deps.log(`failing: ${name}`);
  }
  // A full run's red outlives its fix until a newer full run: say how to get one.
  if (red.full) deps.log(`fixed since? a newer full run clears it: ${RERUN}`);
  if (!red.full && full && !full.red) deps.log(fullGreenLine(full, now));
  if (claims.length === 0) deps.log('unclaimed: bun run main-red -- claim "<cause>"');
  for (const claim of claims) deps.log(`claimed: ${owned(claim)}`);
}

/** Closes the tool's own claims made before `greenAt`, the newest green run (push or full). */
async function closeClaims(
  deps: MainRedDeps,
  claims: Claim[],
  run: MainRun,
  greenAt: string,
): Promise<void> {
  for (const claim of claims) {
    // Only a run newer than the red one the claim was about closes it, and only a claim the tool
    // wrote (it has its run's time): an issue labelled by hand stays for a person.
    if (!claim.runAt || claim.runAt >= greenAt) continue;
    const closing = deps.gh([
      "issue",
      "close",
      String(claim.number),
      "--comment",
      `main is green again: ${run.url}`,
    ]);
    const closed = await closing; // NOSONAR: one issue at a time, each logged as it closes
    if (closed.code === 0) deps.log(`closed: #${claim.number} (${claim.owner})`);
  }
}

/** Prints main's state; on green, closes the claims made before that run. Red is exit 1. */
async function status(deps: MainRedDeps): Promise<number> {
  const { push, full, red, fullUnread } = await mainState(deps);
  const run = red ?? push ?? full;
  if (!run) {
    deps.log("main's CI state is unknown: gh found no finished run, or could not answer");
    return 1;
  }
  const now = (deps.now ?? Date.now)();
  const claims = await openClaims(deps);
  if (red) {
    await reportRed(deps, { red, push, full }, claims, now);
    return 1;
  }
  if (fullUnread) {
    // A full run's red may still be there: nothing closes on the push run alone.
    deps.log(`main is green: ${run.url} (the full runs could not be read: the claims stay open)`);
    return 0;
  }
  deps.log(`main is green: ${run.url}`);
  // The newest green run, push or full: a claim made on a red full run closes on a newer one.
  await closeClaims(deps, claims, run, newestGreenAt(push, full));
  return 0;
}

/** Opens the one issue for this red, or refuses when another owner holds a failing test of it. */
async function claim(deps: MainRedDeps, cause: string, owner: string): Promise<number> {
  const state = await mainState(deps);
  const run = state.red;
  if (!run) {
    deps.log(
      state.push || state.full
        ? "main is green: there is nothing to claim"
        : "main's CI state is unknown: gh could not answer",
    );
    return 1;
  }
  const jobs = await failedJobs(deps, run);
  const failing = await failingTests(deps, run, jobs);
  if (failing.length === 0) {
    // With nothing to compare, two claims could never meet: no claim until the run says.
    deps.log(
      "nothing failing is known for this run yet: read it with bun run main-red, then claim",
    );
    return 1;
  }
  const held = holder(current(await openClaims(deps), run), failing);
  if (held?.owner === owner) {
    deps.log(`already yours: #${held.number}`);
    return 0;
  }
  if (held) {
    deps.log(`already claimed: ${owned(held)}; help there instead of a parallel fix`);
    return 1;
  }
  const body = claimBody(cause, owner, run, jobs, failing);
  const made = await deps.gh([
    "issue",
    "create",
    "--title",
    `main red: ${cause}`,
    "--label",
    LABEL,
    "--body",
    body,
  ]);
  if (made.code !== 0) {
    const why = made.stderr ?? "";
    deps.log(
      why.includes(LABEL) && /not found|could not add label/i.test(why)
        ? "the main-red label is missing: ask fd-coordinator to create it (the tool never creates labels)"
        : `gh issue create failed: ${why.trim()}`,
    );
    return 1;
  }
  const url = made.stdout.trim();
  // Two sessions can claim at the same moment: the older issue stays, this one closes itself.
  const mine = Number(/\/issues\/(\d+)/.exec(url)?.[1] ?? 0);
  const rival = holder(current(await openClaims(deps), run), failing, mine);
  if (rival && mine > 0 && rival.number < mine) {
    await deps.gh([
      "issue",
      "close",
      String(mine),
      "--comment",
      `duplicate of #${rival.number}, claimed at the same moment`,
    ]);
    deps.log(`already claimed: ${owned(rival)}; help there instead of a parallel fix`);
    return 1;
  }
  deps.log(`claimed: ${url}`);
  return 0;
}

/** `main-red [claim "<cause>" [--by <name>]]`; the exit code. */
export async function mainRed(
  args: string[],
  deps: MainRedDeps & { owner: string },
): Promise<number> {
  const words = args.filter((a) => a !== "--");
  deps = jobsOnce(deps);
  try {
    if (words.length === 0) return await status(deps);
    if (words[0] !== "claim") {
      deps.log(USAGE);
      return 2;
    }
    const by = words.indexOf("--by");
    const owner = by === -1 ? deps.owner : (words[by + 1] ?? deps.owner);
    const typed = words.slice(1).find((w, i) => !w.startsWith("--") && words[i] !== "--by");
    const cause = oneLine(typed ?? "", 120);
    if (!cause) {
      deps.log(USAGE);
      return 2;
    }
    return await claim(deps, cause, plainOwner(owner));
  } catch (error) {
    // gh down or answering something else: one line and exit 1, never a stack trace.
    deps.log(`main-red: ${(error as Error).message}`);
    return 1;
  }
}
