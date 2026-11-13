/** Issue #1949: the engineering metrics snapshot of a release, written by `bun run metrics`. */
import type { CoverageSummary } from "./coverage.ts";
import {
  type CiHealth,
  type CiRun,
  ciHealth,
  type MainRed,
  type MergedPr,
  mainRed,
  type PrSize,
  prSize,
  REWORK_MS,
  type TimeWindow,
} from "./gh-metrics.ts";
import {
  type CoupledPair,
  changeCounts,
  coupling,
  type Hotspot,
  hotspots,
  type LogCommit,
  parseLog,
} from "./git-log.ts";

interface GitResult {
  code: number;
  stdout: string;
}

export interface RatchetRow {
  ratchet: string;
  baseline: number;
  today: number;
}

/** The rows of the report's JSON, or null when it is not a list of `{ ratchet, baseline, today }`. */
export function parseRatchetRows(text: string): RatchetRow[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const valid = rows.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof row.ratchet === "string" &&
      typeof row.baseline === "number" &&
      typeof row.today === "number",
  );
  return valid ? rows.map(({ ratchet, baseline, today }) => ({ ratchet, baseline, today })) : null;
}

export interface MetricsDeps {
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GitResult>;
  /** Runs `gh <args>`; stderr is kept for the reason a metric was not read. */
  gh(args: string[]): Promise<GitResult & { stderr?: string }>;
  /** The coverage summary of the latest full green run on the commit, or why there is none. */
  coverage(commit: string): Promise<{ summary: CoverageSummary } | { reason: string }>;
  /** The rows of `scripts/arch-report.ts --json`, or null when the report could not be made. */
  arch(): Promise<RatchetRow[] | null>;
  now(): Date;
}

/** A metric that was not read, and why. */
interface Unavailable {
  metric: string;
  reason: string;
}

interface Windowed<T> {
  /** Null with no previous tag, or when its read failed (`unavailable` says which). */
  sinceRelease: T | null;
  last30Days: T | null;
}

export interface Snapshot {
  schemaVersion: 1;
  tag: string;
  version: string;
  commit: string;
  generatedAt: string;
  window: { previousTag: string | null; previousTagDate: string | null; days: number };
  hotspots: Windowed<Hotspot[]>;
  coupling: Windowed<CoupledPair[]>;
  ratchets: RatchetRow[] | null;
  coverage: CoverageSummary | null;
  ciHealth: Windowed<CiHealth> | null;
  prSize: Windowed<PrSize> | null;
  mainRed: Windowed<MainRed> | null;
  unavailable: Unavailable[];
}

const DAYS = 30;
/** Rows asked of one `gh` list: GitHub caps a list at 1000. */
const LIST_LIMIT = 1000;
const HOTSPOT_LIMIT = 15;
/** Files whose line count is read per window: the most changed, since a ranking needs lines for few. */
const LINE_CANDIDATES = 60;
const LOG_FORMAT = "--format=%x1e%H%x1f%cI%x1f%s";

/** The first line of a git answer, or null when it failed. */
async function line(deps: MetricsDeps, args: string[]): Promise<string | null> {
  const answer = await deps.git(args);
  return answer.code === 0 ? answer.stdout.trim() : null;
}

/** The hotspots and coupled pairs of the commits, with the line counts read at the tag. */
async function gitMetrics(
  deps: MetricsDeps,
  tag: string,
  commits: LogCommit[],
): Promise<{ hotspots: Hotspot[]; coupling: CoupledPair[] }> {
  const counts = changeCounts(commits);
  const lines = new Map<string, number>();
  for (const { path } of counts.slice(0, LINE_CANDIDATES)) {
    const shown = await deps.git(["show", `${tag}:${path}`]);
    if (shown.code === 0) lines.set(path, shown.stdout.split("\n").length - 1);
  }
  return {
    hotspots: hotspots(counts, lines, HOTSPOT_LIMIT),
    coupling: coupling(commits, { minSupport: 5, maxFiles: 30, limit: 15 }),
  };
}

/** The git metrics of one window of history; null, with the reason, when its `git log` failed. */
async function windowMetrics(
  deps: MetricsDeps,
  tag: string,
  window: { name: string; revision: string[] },
  unavailable: Unavailable[],
): Promise<{ hotspots: Hotspot[]; coupling: CoupledPair[]; commits: LogCommit[] } | null> {
  const log = await deps.git(["log", "--no-merges", LOG_FORMAT, "--name-only", ...window.revision]);
  if (log.code === 0) {
    const commits = parseLog(log.stdout);
    return { ...(await gitMetrics(deps, tag, commits)), commits };
  }
  for (const metric of ["hotspots", "coupling"]) {
    unavailable.push({ metric, reason: `git log failed for ${window.name}` });
  }
  return null;
}

/** The JSON list `gh` printed, or why there is none. */
async function ghList<T>(
  deps: MetricsDeps,
  args: string[],
  valid: (row: Record<string, unknown>) => boolean,
): Promise<{ rows: T[]; cut: boolean } | { reason: string }> {
  const answer = await deps.gh(args);
  const what = `gh ${args.slice(0, 2).join(" ")}`;
  if (answer.code !== 0) {
    const detail = (answer.stderr ?? "").trim().split("\n")[0] ?? "";
    return { reason: `${what} failed${detail ? `: ${detail.slice(0, 200)}` : ""}` };
  }
  let rows: unknown;
  try {
    rows = JSON.parse(answer.stdout);
  } catch {
    return { reason: `${what} printed no JSON` };
  }
  const ok =
    Array.isArray(rows) &&
    rows.every((row) => row !== null && typeof row === "object" && valid(row));
  return ok
    ? { rows: rows as T[], cut: (rows as unknown[]).length >= LIST_LIMIT }
    : { reason: `${what} printed an unexpected shape` };
}

/** A UTC day as `YYYY-MM-DD`. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

const DAY_MS = 86_400_000;

/**
 * Every row `gh` lists in the days from `from` to `to`: a range that fills the 1000 rows `gh` gives
 * is split in two and asked again, down to one day, so a busy window is counted whole (#2019). A
 * single day that still fills the list comes back `cut`.
 */
async function ghRange<T>(
  deps: MetricsDeps,
  argsFor: (range: string) => string[],
  from: Date,
  to: Date,
  valid: (row: Record<string, unknown>) => boolean,
): Promise<{ rows: T[]; cut: boolean } | { reason: string }> {
  const got = await ghList<T>(deps, argsFor(`${dayOf(from)}..${dayOf(to)}`), valid);
  if ("reason" in got || !got.cut || dayOf(from) === dayOf(to)) return got;
  const days = Math.round((Date.parse(dayOf(to)) - Date.parse(dayOf(from))) / DAY_MS);
  const middle = new Date(Date.parse(dayOf(from)) + Math.floor(days / 2) * DAY_MS);
  const left = await ghRange<T>(deps, argsFor, from, middle, valid);
  if ("reason" in left) return left;
  const right = await ghRange<T>(deps, argsFor, new Date(middle.getTime() + DAY_MS), to, valid);
  if ("reason" in right) return right;
  return { rows: [...left.rows, ...right.rows], cut: left.cut || right.cut };
}

const RUN_FIELDS = "createdAt,startedAt,updatedAt,attempt,status,conclusion";
const isRun = (row: Record<string, unknown>) =>
  typeof row.createdAt === "string" &&
  typeof row.startedAt === "string" &&
  typeof row.updatedAt === "string" &&
  typeof row.attempt === "number" &&
  typeof row.status === "string" &&
  typeof row.conclusion === "string";
const isMergedPr = (row: Record<string, unknown>) =>
  typeof row.additions === "number" &&
  typeof row.deletions === "number" &&
  typeof row.mergedAt === "string";

/** A metric over both windows. */
const windowed = <T>(
  windows: { sinceRelease: TimeWindow | null; last30Days: TimeWindow },
  of: (window: TimeWindow) => T,
): Windowed<T> => ({
  sinceRelease: windows.sinceRelease ? of(windows.sinceRelease) : null,
  last30Days: of(windows.last30Days),
});

/** A tag name as git writes one: it never starts with `-`, so git cannot read it as an option. */
const TAG_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The snapshot of the repository at `tag`. */
export async function buildSnapshot(deps: MetricsDeps, tag: string): Promise<Snapshot> {
  if (!TAG_NAME.test(tag)) throw new Error(`tag ${tag} is not a tag name`);
  const commit = await line(deps, ["rev-parse", `${tag}^{commit}`]);
  if (commit === null) throw new Error(`tag ${tag} is not in this repository`);
  const tagDate = await line(deps, ["log", "-1", "--format=%cI", tag]);
  if (tagDate === null) throw new Error(`tag ${tag} has no commit date`);
  const previousTag = await line(deps, ["describe", "--tags", "--abbrev=0", `${tag}^`]);
  const previousTagDate = previousTag
    ? await line(deps, ["log", "-1", "--format=%cI", previousTag])
    : null;
  const since = new Date(Date.parse(tagDate) - DAYS * 86_400_000).toISOString();

  const unavailable: Unavailable[] = [];
  const last30Days = await windowMetrics(
    deps,
    tag,
    { name: `the last ${DAYS} days`, revision: [`--since=${since}`, tag] },
    unavailable,
  );
  const sinceRelease = previousTag
    ? await windowMetrics(
        deps,
        tag,
        { name: `the range since ${previousTag}`, revision: [`${previousTag}..${tag}`] },
        unavailable,
      )
    : null;

  const ratchets = await deps.arch().catch(() => null);
  if (ratchets === null)
    unavailable.push({ metric: "ratchets", reason: "arch-report.ts wrote no report" });
  const covered = await deps.coverage(commit).catch((error: Error) => ({ reason: error.message }));
  if ("reason" in covered) unavailable.push({ metric: "coverage", reason: covered.reason });

  const to = new Date(tagDate);
  const windows: { sinceRelease: TimeWindow | null; last30Days: TimeWindow } = {
    sinceRelease: previousTagDate ? { from: new Date(previousTagDate), to } : null,
    last30Days: { from: new Date(since), to },
  };
  // One query for both windows: from the earlier start to the tag, in day ranges.
  const starts = [windows.last30Days.from, windows.sinceRelease?.from].filter(
    (d): d is Date => !!d,
  );
  const wideFrom = new Date(Math.min(...starts.map((d) => d.getTime())));
  const runsOf = (range: string) => [
    "run",
    "list",
    "--workflow",
    "CI",
    "--created",
    range,
    "--limit",
    String(LIST_LIMIT),
    "--json",
    RUN_FIELDS,
  ];
  const ci = await ghRange<CiRun>(
    deps,
    (range) => [...runsOf(range), "--event", "pull_request"],
    wideFrom,
    to,
    isRun,
  );
  const main = await ghRange<CiRun>(
    deps,
    (range) => [...runsOf(range), "--branch", "main", "--event", "push"],
    wideFrom,
    to,
    isRun,
  );
  const prs = await ghRange<MergedPr>(
    deps,
    (range) => [
      "pr",
      "list",
      "--state",
      "merged",
      "--search",
      `merged:${range}`,
      "--limit",
      String(LIST_LIMIT),
      "--json",
      "additions,deletions,mergedAt,title,files",
    ],
    // A fix on the window's first day can answer a feat merged up to REWORK_MS before it.
    new Date(wideFrom.getTime() - REWORK_MS),
    to,
    isMergedPr,
  );
  for (const [metric, read] of [
    ["ciHealth", ci],
    ["mainRed", main],
    ["prSize", prs],
  ] as const) {
    if ("reason" in read) unavailable.push({ metric, reason: read.reason });
    // A list cut at the limit still gives its figures, for the newest rows only; the note says so.
    else if (read.cut) {
      unavailable.push({
        metric,
        reason: `one day holds ${LIST_LIMIT} rows or more, the most gh gives: the oldest of that day are not counted`,
      });
    }
  }

  return {
    schemaVersion: 1,
    tag,
    version: tag.replace(/^v/, ""),
    commit,
    generatedAt: deps.now().toISOString(),
    window: { previousTag, previousTagDate, days: DAYS },
    hotspots: {
      sinceRelease: sinceRelease?.hotspots ?? null,
      last30Days: last30Days?.hotspots ?? null,
    },
    coupling: {
      sinceRelease: sinceRelease?.coupling ?? null,
      last30Days: last30Days?.coupling ?? null,
    },
    ratchets,
    coverage: "summary" in covered ? covered.summary : null,
    ciHealth: "rows" in ci ? windowed(windows, (w) => ciHealth(ci.rows, w)) : null,
    prSize:
      "rows" in prs
        ? {
            sinceRelease: windows.sinceRelease
              ? prSize(prs.rows, sinceRelease?.commits ?? [], windows.sinceRelease)
              : null,
            last30Days: prSize(prs.rows, last30Days?.commits ?? [], windows.last30Days),
          }
        : null,
    mainRed: "rows" in main ? windowed(windows, (w) => mainRed(main.rows, w)) : null,
    unavailable,
  };
}
