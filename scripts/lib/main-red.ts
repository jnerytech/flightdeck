/**
 * Issue #1246: a red main is claimed once, and every session sees the claim before fixing it.
 * `bun run main-red` reads main's latest finished CI run, its latest full run (#1381: the push
 * runs test only what changed) and the open `main-red` issues; `claim`
 * opens one issue per red, refused when another owner already claimed one of its failing tests.
 * The SessionStart hook and `bun run pr -- open/update` print the one-line warning.
 */
import type { GhResult } from "./ci-branch.ts";

export interface MainRedDeps {
  /** Runs `gh <args>` in the repository; stderr is how a missing label is told apart. */
  gh(args: string[]): Promise<GhResult>;
  log(line: string): void;
  /** The clock, for a full run's age (#1381); `Date.now` by default. */
  now?: () => number;
}

/** Main's latest CI run that finished green or red (a cancelled one says nothing). */
export interface MainRun {
  id: number;
  url: string;
  createdAt: string;
  red: boolean;
  /** When main's latest green run among those read started; a claim older than that is stale. */
  lastGreenAt: string;
  /** #1381: a full run (the schedule or a dispatch with only=all), not a push run. */
  full?: boolean;
}

/** An open `main-red` issue, read back from its title and body. */
export interface Claim {
  number: number;
  cause: string;
  owner: string;
  failing: string[];
  /** The failed jobs of the run it was claimed on; empty when the issue does not say. */
  jobs: string[];
  runAt: string;
}

const LABEL = "main-red";
const USAGE = 'usage: bun run main-red [-- claim "<cause>" [--by <name>]]';

/**
 * Issue text is data, and it reaches every session's context: one line with no control
 * character, at most `max` characters.
 */
function oneLine(text: string, max: number): string {
  const printable = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A session name (fd-harness): letters, digits, dots, dashes and underscores; else unknown. */
const plainOwner = (name: string) => (/^[\w.-]{1,32}$/.test(name) ? name : "unknown");

/** gh's answer as JSON, or null when it is not (an auth prompt, a proxy page). */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
  const finished = runs as Array<{
    databaseId: number;
    conclusion: string;
    createdAt: string;
    url: string;
  }>;
  const run = finished.find((r) => r.conclusion === "success" || r.conclusion === "failure");
  if (!run) return null;
  return {
    id: run.databaseId,
    url: run.url,
    createdAt: run.createdAt,
    red: run.conclusion !== "success",
    lastGreenAt: finished.find((r) => r.conclusion === "success")?.createdAt ?? "",
  };
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
    finishedOn(deps, "workflow_dispatch", 10),
  ]);
  // A dispatch with only=screenshots runs no test suite: only one that did is a full run. Only a
  // dispatch newer than the latest scheduled run can be the latest full run.
  const newer = dispatched.filter((r) => !scheduled[0] || r.createdAt > scheduled[0].createdAt);
  const jobsOf = new Map(
    await Promise.all(
      newer.map(async (r) => [r.databaseId, await runJobs(deps, r.databaseId)] as const),
    ),
  );
  // A screenshots dispatch lists its test suite job too, skipped: only one that ran counts, timed
  // out or cancelled included (its red is a full run's red).
  const fullDispatch = newer.find((r) =>
    (jobsOf.get(r.databaseId) ?? []).some(
      (j) => /^test suite/i.test(j.name) && Boolean(j.conclusion) && j.conclusion !== "skipped",
    ),
  );
  const full = [scheduled[0], fullDispatch]
    .filter((r): r is RunRow => r !== undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!full) return null;
  // Windows gates nothing (#534): a full run red only there is green. Jobs gh cannot read leave
  // a failed run red: the verdict fails closed, as the push run's does. A green run needs no jobs.
  let red = false;
  if (full.conclusion === "failure") {
    const jobs = jobsOf.has(full.databaseId)
      ? (jobsOf.get(full.databaseId) ?? null)
      : await runJobs(deps, full.databaseId);
    red = jobs === null || failed(jobs).length > 0;
  }
  const greens = [...scheduled, ...(fullDispatch ? [fullDispatch] : [])]
    .filter((r) => r.conclusion === "success")
    .map((r) => r.createdAt)
    .sort((a, b) => a.localeCompare(b));
  return {
    id: full.databaseId,
    url: full.url,
    createdAt: full.createdAt,
    red,
    lastGreenAt: greens.at(-1) ?? "",
    full: true,
  };
}

interface RunRow {
  databaseId: number;
  conclusion: string;
  createdAt: string;
  url: string;
}

interface Job {
  name: string;
  conclusion: string;
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
  return (runs as RunRow[]).filter((r) => r.conclusion === "success" || r.conclusion === "failure");
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

/** The failed jobs' names, Windows left out (a signal that gates nothing, #534). */
const failed = (jobs: Job[]) =>
  jobs
    .filter((j) => !PASSED.has(j.conclusion) && !/windows/i.test(j.name))
    .map((j) => oneLine(j.name, 100));

/** A job's conclusions that are no failure; timed out, cancelled or not started are (#1381). */
const PASSED = new Set(["success", "skipped", "neutral"]);

/** How a fixed full run's red is cleared: a newer full run, dispatched on main. */
const RERUN = "gh workflow run CI --ref main -f only=all";

/** How long ago a run started, as `2h 5m` or `40m`. */
function age(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
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

/** The run that makes main red: the push run first, then the full run. */
function redOf(push: MainRun | null, full: MainRun | null): MainRun | null {
  if (push?.red) return push;
  return full?.red ? full : null;
}

/** How a red run is named: a full run says so, with its age. */
const redName = (run: MainRun, now: number) =>
  run.full
    ? `${run.url} (full run, ${age(run.createdAt, now)} old; fixed since? ${RERUN})`
    : run.url;

/** The value of `<key>: <value>` in an issue body the tool wrote. */
const field = (body: string, key: string) =>
  body
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2)
    .trim() ?? "";

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
  return (issues as Array<{ number: number; title: string; body: string }>).map(
    ({ number, title, body }) => {
      // A body edited on the web has CRLF line ends.
      const lines = body.split(/\r?\n/).map((line) => line.trimEnd());
      const from = lines.indexOf("Failing:");
      const failing =
        from === -1
          ? []
          : lines
              .slice(from + 1)
              .flatMap((line) => (line.startsWith("- ") ? [oneLine(line.slice(2), 200)] : []));
      // Written as JSON, so a matrix job with a comma in its name stays one job.
      const listed = parsed(field(body, "Jobs"));
      const jobs = (Array.isArray(listed) ? listed : [])
        .filter((job): job is string => typeof job === "string")
        .map((job) => oneLine(job, 100))
        .filter(Boolean);
      return {
        number,
        cause: oneLine(field(body, "Cause") || title.replace(/^main red: /, ""), 80),
        owner: plainOwner(field(body, "Owner")),
        failing,
        jobs,
        runAt: field(body, "Run at"),
      };
    },
  );
}

/** The failed jobs of a run, Windows left out (a signal that gates nothing, #534). */
async function failedJobs(deps: Pick<MainRedDeps, "gh">, run: MainRun): Promise<string[]> {
  return failed((await runJobs(deps, run.id)) ?? []);
}

/** The failing tests of a red run (its `(fail)` lines), else its failed jobs as `job: <name>`. */
async function failingOf(
  deps: Pick<MainRedDeps, "gh">,
  run: MainRun,
  jobs: string[],
): Promise<string[]> {
  const log = await deps.gh(["run", "view", String(run.id), "--log-failed"]);
  const tests: string[] = [];
  // Each log line starts with its job's name: Windows lines are left out (#534), as its jobs are.
  const lines = (log.code === 0 ? log.stdout : "")
    .split(/\r?\n/)
    .filter((line) => !/windows/i.test(line.split("\t")[0] ?? ""));
  for (const line of lines) {
    const match = /\(fail\) (.+?) \[\d+(?:\.\d+)?m?s\]/.exec(line);
    const name = oneLine(match?.[1] ?? "", 200);
    if (name && !tests.includes(name)) tests.push(name);
  }
  return tests.length > 0 ? tests : jobs.map((job) => `job: ${job}`);
}

/** The claims still about this red: none made before main's latest green run. */
const current = (claims: Claim[], run: MainRun) =>
  claims.filter((c) => !(c.runAt && run.lastGreenAt && c.runAt < run.lastGreenAt));

const owned = (claim: Claim) => `#${claim.number} by ${claim.owner} (${claim.cause})`;

/** The one-line warning while main is red, or null when it is green or GitHub cannot say. */
export async function mainRedLine(deps: Pick<MainRedDeps, "gh" | "now">): Promise<string | null> {
  try {
    deps = jobsOnce(deps);
    // Asked together: the hook's deadline, not GitHub, is what would hide a red.
    const [state, open] = await Promise.all([mainState(deps), openClaims(deps)]);
    const run = state.red;
    if (!run) return null;
    const claims = current(open, run);
    const since = redName(run, (deps.now ?? Date.now)());
    const unclaimed = `main is red since ${since}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`;
    if (claims.length === 0) return unclaimed;
    // A claim covers this red when its jobs failed here too; one that does not say still counts.
    const jobs = await failedJobs(deps, run);
    const covering = claims.filter(
      (c) => c.jobs.length === 0 || jobs.length === 0 || c.jobs.some((j) => jobs.includes(j)),
    );
    if (covering.length === 0) return unclaimed;
    // The cause is quoted: it is what someone typed, never an instruction.
    const who = covering
      .map((c) => `claimed in #${c.number} by ${c.owner} (${JSON.stringify(c.cause)})`)
      .join("; ");
    return `main is red since ${since}: ${who}; do not start a parallel fix`;
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
    // Both verdicts are shown when they differ: a push run checks less than a full run.
    deps.log(
      red.full && push
        ? `main is red: ${red.url} (full run, ${age(red.createdAt, now)} old; the push run is green: ${push.url})`
        : `main is red: ${red.full ? `${red.url} (full run, ${age(red.createdAt, now)} old)` : red.url}`,
    );
    for (const name of await failingOf(deps, red, await failedJobs(deps, red))) {
      deps.log(`failing: ${name}`);
    }
    // A full run's red outlives its fix until a newer full run: say how to get one.
    if (red.full) deps.log(`fixed since? a newer full run clears it: ${RERUN}`);
    if (!red.full && full && !full.red) {
      deps.log(`the full run is green: ${full.url} (${age(full.createdAt, now)} old)`);
    }
    if (claims.length === 0) deps.log('unclaimed: bun run main-red -- claim "<cause>"');
    for (const claim of claims) deps.log(`claimed: ${owned(claim)}`);
    return 1;
  }
  if (fullUnread) {
    // A full run's red may still be there: nothing closes on the push run alone.
    deps.log(`main is green: ${run.url} (the full runs could not be read: the claims stay open)`);
    return 0;
  }
  deps.log(`main is green: ${run.url}`);
  // The newest green run, push or full: a claim made on a red full run closes on a newer one.
  const greenAt =
    [push?.createdAt ?? "", full?.createdAt ?? ""].sort((a, b) => b.localeCompare(a))[0] ?? "";
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
  return 0;
}

/** The first open claim, by number, that holds one of `failing`. */
const holder = (claims: Claim[], failing: string[], except?: number) =>
  claims
    .filter((c) => c.number !== except && c.failing.some((name) => failing.includes(name)))
    .sort((a, b) => a.number - b.number)[0];

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
  const failing = await failingOf(deps, run, jobs);
  if (failing.length === 0) {
    // With nothing to compare, two claims could never meet: no claim until the run says.
    deps.log(
      "nothing failing is known for this run yet: read it with bun run main-red, then claim",
    );
    return 1;
  }
  const held = holder(current(await openClaims(deps), run), failing);
  if (held && held.owner === owner) {
    deps.log(`already yours: #${held.number}`);
    return 0;
  }
  if (held) {
    deps.log(`already claimed: ${owned(held)}; help there instead of a parallel fix`);
    return 1;
  }
  const body = [
    `Cause: ${cause}`,
    `Owner: ${owner}`,
    `Run: ${run.url}`,
    `Run at: ${run.createdAt}`,
    `Jobs: ${JSON.stringify(jobs)}`,
    "Failing:",
    ...failing.map((name) => `- ${name}`),
  ].join("\n");
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
