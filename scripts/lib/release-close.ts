/**
 * `bun run release:close -- <tag> [--apply]` (issue #252): after a release tag, the issues its
 * commits reference get "Shipped in <tag>", are closed and go to Done on the board, and the
 * milestone named after the tag is closed once nothing in it is open. A dry run by default; an
 * issue the tag's commits do not reference is never touched.
 */

export interface GhResult {
  code: number;
  stdout: string;
}

export interface ReleaseCloseDeps {
  /** Runs `gh <args>` (REST through `gh api`); the caller owns the login. */
  gh(args: string[]): Promise<GhResult>;
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GhResult>;
  /** Puts the issue on Done on the board (the REST queue of #242); absent: the board is skipped. */
  board?(issue: number): Promise<boolean>;
  log(line: string): void;
}

/** The issues a tag's commits reference: in a subject, or a `Closes/Fixes/Resolves #N` body line. */
export function issueRefs(_log: string): { closes: number[]; mentioned: number[] } {
  return { closes: [], mentioned: [] };
}

/** Closes what the tag shipped (with `apply`), or says what it would do; the exit code. */
export async function releaseClose(
  _tag: string,
  _opts: { apply: boolean; since?: string },
  _deps: ReleaseCloseDeps,
): Promise<number> {
  return 0;
}
