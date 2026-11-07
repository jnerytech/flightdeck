/**
 * Issue #77, slice D3: whether a fixing round drifted from its PR, measured with git alone. The
 * caller reads the numstats (`git diff --numstat -z --no-renames`); this decides.
 */

/** One file of a diff: its lines added and removed (0 and 0 for a binary file). */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

/** Why a round is held: the files it touched outside the PR, and its churn against the limit. */
export interface Drift {
  outside: string[];
  churn: number;
  limit: number;
}

/** The smallest churn limit: a round may always change this many lines in the PR's files. */
export const MIN_CHURN_LIMIT = 200;

/** The files of `git diff --numstat -z --no-renames`. */
export function parseNumstat(text: string): FileChange[] {
  return text
    .split("\0")
    .filter((record) => record !== "")
    .map((record) => {
      const [added = "", removed = "", ...path] = record.split("\t");
      // A binary file has "-" for both: it is touched, with no lines.
      return { path: path.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    });
}

/** A glob with no "/" matches a file by its name, wherever it is (`*.snap`). */
function allowed(path: string, allow: Bun.Glob[], names: Bun.Glob[]): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return allow.some((glob) => glob.match(path)) || names.some((glob) => glob.match(name));
}

const churnOf = (files: FileChange[]) => files.reduce((sum, f) => sum + f.added + f.removed, 0);

/**
 * A round drifts when it touches a file outside the PR's footprint that its trigger does not
 * name, or when its churn passes `max(200, the footprint's churn)`. Files the `allow` globs match
 * never count. `null` when the round stays in scope.
 */
export function measureDrift(input: {
  footprint: FileChange[];
  round: FileChange[];
  named: string[];
  allow: string[];
}): Drift | null {
  const globs = input.allow.map((pattern) => new Bun.Glob(pattern));
  const names = input.allow.filter((p) => !p.includes("/")).map((p) => new Bun.Glob(p));
  const counts = (f: FileChange) => !allowed(f.path, globs, names);
  const footprint = input.footprint.filter(counts);
  const round = input.round.filter(counts);
  const scope = new Set([...footprint.map((f) => f.path), ...input.named]);
  const outside = round.map((f) => f.path).filter((path) => !scope.has(path));
  const churn = churnOf(round);
  const limit = Math.max(MIN_CHURN_LIMIT, churnOf(footprint));
  return outside.length > 0 || churn > limit ? { outside, churn, limit } : null;
}
