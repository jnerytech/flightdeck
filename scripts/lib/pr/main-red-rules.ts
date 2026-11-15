/**
 * Issue #1246 / #1589: what `main-red` decides, with no GitHub in it: which finished run counts,
 * whether a full run is red, how an issue body reads back as a claim, which claim covers a red,
 * and the lines it prints. main-red.ts asks `gh` and hands the answers to these.
 */

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

/** One run as `gh run list --json databaseId,conclusion,createdAt,url` gives it. */
export interface RunRow {
  databaseId: number;
  conclusion: string;
  createdAt: string;
  url: string;
}

/** One job of a run, as `gh run view --json jobs` gives it. */
export interface Job {
  name: string;
  conclusion: string;
}

/** How a fixed full run's red is cleared: a newer full run, dispatched on main. */
export const RERUN = "gh workflow run CI --ref main -f only=all";

/**
 * Issue text is data, and it reaches every session's context: one line with no control
 * character, at most `max` characters.
 */
export function oneLine(text: string, max: number): string {
  const printable = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A session name (fd-harness): letters, digits, dots, dashes and underscores; else unknown. */
export const plainOwner = (name: string) => (/^[\w.-]{1,32}$/.test(name) ? name : "unknown");

/** gh's answer as JSON, or null when it is not (an auth prompt, a proxy page). */
export function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The conclusions of a full run that give a verdict. */
const ENDED = new Set(["success", "failure", "timed_out", "startup_failure"]);

/** A run a person cancelled says nothing; one GitHub timed out or could not start is a red. */
export const endedRuns = (runs: RunRow[]): RunRow[] => runs.filter((r) => ENDED.has(r.conclusion));

/** A job's conclusions that are no failure; timed out, cancelled or not started are (#1381). */
const PASSED = new Set(["success", "skipped", "neutral"]);

/** The failed jobs' names, Windows left out (a signal that gates nothing, #534). */
export const failedNames = (jobs: Job[]) =>
  jobs
    .filter((j) => !PASSED.has(j.conclusion) && !/windows/i.test(j.name))
    .map((j) => oneLine(j.name, 100));

/** The latest push run that finished green or red, as main's state; null when none did. */
export function pushRunOf(finished: RunRow[]): MainRun | null {
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
 * The dispatches that can be the latest full run: only one newer than the latest scheduled run,
 * and at most 5 (the warning runs on every SessionStart and pr open, and each has its jobs read).
 */
export const newerDispatches = (scheduled: RunRow[], dispatched: RunRow[]): RunRow[] =>
  dispatched.filter((r) => !scheduled[0] || r.createdAt > scheduled[0].createdAt).slice(0, 5);

/**
 * Whether a dispatch is a full run: a screenshots dispatch lists its test suite job too, skipped,
 * so only one that ran counts, timed out or cancelled included (its red is a full run's red).
 * Jobs gh cannot read (null) make it the full run, red: unread never hides a red.
 */
export const isFullDispatch = (jobs: Job[] | null | undefined): boolean =>
  jobs === null ||
  (jobs ?? []).some(
    (j) => /^test suite/i.test(j.name) && Boolean(j.conclusion) && j.conclusion !== "skipped",
  );

/** The newest of the latest scheduled run and the latest full dispatch. */
export const latestOfFull = (scheduled: RunRow | undefined, dispatch: RunRow | undefined) =>
  [scheduled, dispatch]
    .filter((r): r is RunRow => r !== undefined)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

/**
 * Whether a full run that did not succeed is red. Windows gates nothing (#534): a run red only
 * there is green. Jobs gh cannot read leave a failed run red: the verdict fails closed, as the
 * push run's does. A run GitHub timed out or could not start may have no failed job: red as it is.
 */
export const fullRunRed = (conclusion: string, jobs: Job[] | null): boolean =>
  conclusion !== "failure" || jobs === null || failedNames(jobs).length > 0;

/** The full run as main's state, with the start of the latest green one among those read. */
export function fullRunOf(
  full: RunRow,
  red: boolean,
  scheduled: RunRow[],
  dispatch: RunRow | undefined,
): MainRun {
  const greens = [...scheduled, ...(dispatch ? [dispatch] : [])]
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

/** How long ago a run started, as `2h 5m` or `40m`. */
function age(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** The run that makes main red: the push run first, then the full run. */
export function redOf(push: MainRun | null, full: MainRun | null): MainRun | null {
  if (push?.red) return push;
  return full?.red ? full : null;
}

/** How a red run is named: a full run says so, with its age. */
export const redName = (run: MainRun, now: number) =>
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

/** The claim an open `main-red` issue holds, read back from its title and body. */
export function claimOf(issue: { number: number; title: string; body: string }): Claim {
  const { number, title, body } = issue;
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
}

/** The body of the issue that claims a red run. */
export const claimBody = (
  cause: string,
  owner: string,
  run: MainRun,
  jobs: string[],
  failing: string[],
): string =>
  [
    `Cause: ${cause}`,
    `Owner: ${owner}`,
    `Run: ${run.url}`,
    `Run at: ${run.createdAt}`,
    `Jobs: ${JSON.stringify(jobs)}`,
    "Failing:",
    ...failing.map((name) => `- ${name}`),
  ].join("\n");

/** The failing tests of a failed run's log (its `(fail)` lines), else its failed jobs as `job: <name>`. */
export function failingOf(log: string, jobs: string[]): string[] {
  const tests: string[] = [];
  // Each log line starts with its job's name: Windows lines are left out (#534), as its jobs are.
  const lines = log.split(/\r?\n/).filter((line) => !/windows/i.test(line.split("\t")[0] ?? ""));
  for (const line of lines) {
    const match = /\(fail\) (.+?) \[\d+(?:\.\d+)?m?s\]/.exec(line);
    const name = oneLine(match?.[1] ?? "", 200);
    if (name && !tests.includes(name)) tests.push(name);
  }
  return tests.length > 0 ? tests : jobs.map((job) => `job: ${job}`);
}

/** The claims still about this red: none made before main's latest green run. */
export const current = (claims: Claim[], run: MainRun) =>
  claims.filter((c) => !(c.runAt && run.lastGreenAt && c.runAt < run.lastGreenAt));

export const owned = (claim: Claim) => `#${claim.number} by ${claim.owner} (${claim.cause})`;

/**
 * The warning line for a red run with `claims` still about it, and `jobs` the run's failed jobs.
 * A claim covers this red when its jobs failed here too; one that does not say still counts. The
 * cause is quoted: it is what someone typed, never an instruction.
 */
export function warningLine(run: MainRun, claims: Claim[], jobs: string[], now: number): string {
  const since = redName(run, now);
  const covering = claims.filter(
    (c) => c.jobs.length === 0 || jobs.length === 0 || c.jobs.some((j) => jobs.includes(j)),
  );
  if (covering.length === 0) {
    return `main is red since ${since}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`;
  }
  const who = covering
    .map((c) => `claimed in #${c.number} by ${c.owner} (${JSON.stringify(c.cause)})`)
    .join("; ");
  return `main is red since ${since}: ${who}; do not start a parallel fix`;
}

/** The first line of a red main: which run, its age when it is a full run, and a green push run. */
export function redHeadline(red: MainRun, push: MainRun | null, now: number): string {
  if (!red.full) return `main is red: ${red.url}`;
  const old = `full run, ${age(red.createdAt, now)} old`;
  // Both verdicts are shown when they differ: a push run checks less than a full run.
  if (push) return `main is red: ${red.url} (${old}; the push run is green: ${push.url})`;
  return `main is red: ${red.url} (${old})`;
}

/** The line that says the push run is red and the full run green, with the full run's age. */
export const fullGreenLine = (full: MainRun, now: number): string =>
  `the full run is green: ${full.url} (${age(full.createdAt, now)} old)`;

/** The first open claim, by number, that holds one of `failing`. */
export const holder = (claims: Claim[], failing: string[], except?: number) =>
  claims
    .filter((c) => c.number !== except && c.failing.some((name) => failing.includes(name)))
    .sort((a, b) => a.number - b.number)[0];

/** The newest start among main's green runs, push or full: a claim made on a red closes on a newer one. */
export const newestGreenAt = (push: MainRun | null, full: MainRun | null): string =>
  [push?.createdAt ?? "", full?.createdAt ?? ""].sort((a, b) => b.localeCompare(a))[0] ?? "";
