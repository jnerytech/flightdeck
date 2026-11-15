/**
 * What every `bun run pr` command shares (#1589): the dependencies a command is given (`gh`, `git`,
 * the clock, the log), the PR it works on, and the repository path and branch name the GitHub calls
 * use. No logic, so each command's module and `pr-flow.ts` can import it without a cycle.
 */

interface GhResult {
  code: number;
  stdout: string;
}

export interface PrFlowDeps {
  /** Runs `gh <args>`; `gh api` fills `{owner}` and `{repo}` from the current repository. */
  gh(args: string[]): Promise<GhResult>;
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GhResult>;
  /** Runs a command (the FLIGHTDECK_PR_OPENED hook, #273); only its exit code is read. */
  run?(command: string[]): Promise<GhResult>;
  env: Record<string, string | undefined>;
  log(line: string): void;
  /** The clock in ms (Date.now when absent): the age of a PR run (#741). */
  now?: () => number;
  /** #1246: the one-line warning while main is red (null when green); absent, nothing is said. */
  mainRed?: () => Promise<string | null>;
}

export interface Pr {
  number: number;
  head: string;
  sha: string;
  base: string;
  draft: boolean;
  title: string;
}

export const REPO = "repos/{owner}/{repo}";
export const MAIN = "main";
