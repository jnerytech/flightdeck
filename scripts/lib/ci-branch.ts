/** `bun run ci:branch <branch>`: runs the full CI on a pushed work branch and reports the result (#129). */

export interface GhResult {
  code: number;
  stdout: string;
}

export interface CiBranchDeps {
  /** Runs `gh <args>`; the caller owns the repository and the login. */
  gh: (args: string[]) => Promise<GhResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

export interface CiBranchOptions {
  /** "screenshots" runs only the prints, axe and e2e job. */
  only: "all" | "screenshots";
  /** How long to wait for the run to appear and then to finish. */
  appearMs: number;
  waitMs: number;
  pollMs: number;
}

export const CI_BRANCH_DEFAULTS: CiBranchOptions = {
  only: "all",
  appearMs: 120_000,
  waitMs: 60 * 60_000,
  pollMs: 15_000,
};

/** Dispatches CI on `branch`, waits for it and prints the result. Exit code: 0 green, 1 red, 2 could not run. */
export async function ciBranch(
  _branch: string,
  _deps: CiBranchDeps,
  _options: CiBranchOptions = CI_BRANCH_DEFAULTS,
): Promise<number> {
  return 99;
}
