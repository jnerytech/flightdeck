/** Issue #1949: the engineering metrics snapshot of a release, written by `bun run metrics`. */
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
  coverage: null;
  ciHealth: null;
  prSize: null;
  mainRed: null;
  unavailable: Unavailable[];
}

const DAYS = 30;
const HOTSPOT_LIMIT = 15;
/** Files whose line count is read per window: the most changed, since a ranking needs lines for few. */
const LINE_CANDIDATES = 60;
const LATER_TASK = "not collected by this version of the script (#1949, a later task)";
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
): Promise<{ hotspots: Hotspot[]; coupling: CoupledPair[] } | null> {
  const log = await deps.git(["log", "--no-merges", LOG_FORMAT, "--name-only", ...window.revision]);
  if (log.code === 0) return gitMetrics(deps, tag, parseLog(log.stdout));
  for (const metric of ["hotspots", "coupling"]) {
    unavailable.push({ metric, reason: `git log failed for ${window.name}` });
  }
  return null;
}

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
  for (const metric of ["coverage", "ciHealth", "prSize", "mainRed"]) {
    unavailable.push({ metric, reason: LATER_TASK });
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
    coverage: null,
    ciHealth: null,
    prSize: null,
    mainRed: null,
    unavailable,
  };
}
