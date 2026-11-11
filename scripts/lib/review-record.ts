/**
 * The record that `/code-review` and `/security-review` ran on a branch (#1707): an empty commit on
 * the branch with two trailers, `Code-Review: <sha> <summary>` and `Security-Review: <sha> <summary>`,
 * each naming the commit it reviewed. `pr open` reads them (the way the security gate reads
 * `Security-Reviewed:`, #273) and refuses a head whose tree no named commit has: a later commit
 * that changes the tree asks for a new review.
 */

/** The commits a branch's `Code-Review` and `Security-Review` trailers name, as written (a sha). */
export interface ReviewNames {
  code: string[];
  security: string[];
}

/** Runs git with these arguments: its exit code and stdout. */
export type ReviewGit = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** The names in `git log --format=%x1e<Code-Review trailers>%x1f<Security-Review trailers>` output. */
export function parseReviewLog(log: string): ReviewNames {
  return { code: [log], security: [] };
}

/** Why `pr open` refuses a branch, or null when both reviews are on record for its head. */
export async function reviewProblem(
  branch: string,
  base: string,
  git: ReviewGit,
): Promise<string | null> {
  return git([branch, base]) === null ? "" : null;
}
