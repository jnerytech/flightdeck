/**
 * A git merge driver for the ratchet baselines keyed by path (#2270): `src-size-baseline.json` and
 * `json-parse-baseline.json` (path to a count that only goes down) and `fast-coverage-baseline.json`
 * (a sorted list of paths). The files are already sorted, one key per line, yet two branches that
 * rename neighbouring paths change adjacent lines, and git's line merge refuses those; this merge
 * works key by key instead. GitHub runs no custom driver: a PR still goes DIRTY, and the local
 * `git merge origin/main` resolves it with no hand edit.
 *
 * Self-contained on purpose: the driver runs the worktree's own copy of `scripts/merge-baseline.ts`.
 */

export type BaselineMerge = { ok: true; text: string } | { ok: false; reason: string };

/** The git config name of the driver; `.gitattributes` names the files with `merge=baseline-json`. */
export const DRIVER_NAME = "baseline-json";

/**
 * The driver's command line; git runs it through the shell in the worktree's top folder. A worktree
 * whose branch predates the driver has no script: git's line merge runs there, as with no driver.
 */
export const DRIVER_COMMAND =
  "if [ -f scripts/merge-baseline.ts ]; then bun scripts/merge-baseline.ts %O %A %B; else git merge-file -L ours -L base -L theirs %A %O %B; fi";

/**
 * What the driver writes when it refuses: both versions whole between conflict markers, so a raise
 * git's line merge would take cleanly still shows, and `git add` alone cannot take it unseen.
 */
export function conflictText(ours: string, theirs: string): string {
  const line = (text: string) => (text.endsWith("\n") ? text : `${text}\n`);
  return `<<<<<<< ours\n${line(ours)}=======\n${line(theirs)}>>>>>>> theirs\n`;
}

type Counts = Record<string, number>;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isPaths = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isCounts = (value: unknown): value is Counts =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((count) => typeof count === "number");

const format = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A path is in the merge when both sides keep it, or when one side added it. */
function mergePaths(base: string[], ours: string[], theirs: string[]): string[] {
  const inBase = new Set(base);
  const inOurs = new Set(ours);
  const inTheirs = new Set(theirs);
  const all = new Set([...base, ...ours, ...theirs]);
  return [...all]
    .filter((path) =>
      inBase.has(path)
        ? inOurs.has(path) && inTheirs.has(path)
        : inOurs.has(path) || inTheirs.has(path),
    )
    .sort(byCodeUnit);
}

/** Each key from the side that changed it; the lower count when both lowered it; a raise refuses. */
function mergeCounts(base: Counts, ours: Counts, theirs: Counts): BaselineMerge {
  const merged: Counts = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const key of [...keys].sort(byCodeUnit)) {
    const was = base[key];
    const sides = [ours[key], theirs[key]];
    if (was !== undefined && sides.some((count) => count !== undefined && count > was)) {
      return { ok: false, reason: `${key} goes up from ${was}` };
    }
    // A key one side deleted (a rename or a removal) stays deleted.
    if (was !== undefined && sides.includes(undefined)) continue;
    // Both sides added it: the merged file holds both additions, so its count may be neither.
    if (
      was === undefined &&
      sides[0] !== undefined &&
      sides[1] !== undefined &&
      sides[0] !== sides[1]
    ) {
      return { ok: false, reason: `${key} added with ${sides[0]} and ${sides[1]}` };
    }
    const counts = sides.filter((count): count is number => count !== undefined);
    if (counts.length > 0) merged[key] = Math.min(...counts);
  }
  return { ok: true, text: format(merged) };
}

/** Merges the three versions of a baseline; `ok: false` leaves the conflict to a person. */
export function mergeBaselines(base: string, ours: string, theirs: string): BaselineMerge {
  const [b, o, t] = [parse(base), parse(ours), parse(theirs)];
  if (isPaths(b) && isPaths(o) && isPaths(t)) {
    return { ok: true, text: format(mergePaths(b, o, t)) };
  }
  if (isCounts(b) && isCounts(o) && isCounts(t)) return mergeCounts(b, o, t);
  return { ok: false, reason: "not three path lists or three count maps" };
}

export type GitRun = (args: string[]) => { status: number; stdout: string };

/**
 * Registers the driver in the repository's git config when it is missing or different. The config
 * is the repository's, shared by every worktree, so one write covers them all.
 */
export function registerMergeDriver(git: GitRun): boolean {
  const current = git(["config", "--get", `merge.${DRIVER_NAME}.driver`]);
  if (current.status === 0 && current.stdout.trim() === DRIVER_COMMAND) return false;
  git(["config", `merge.${DRIVER_NAME}.name`, "path-keyed ratchet baselines (#2270)"]);
  git(["config", `merge.${DRIVER_NAME}.driver`, DRIVER_COMMAND]);
  return true;
}
