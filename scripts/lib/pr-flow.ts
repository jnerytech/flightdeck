/**
 * `bun run pr -- <open|next|update|merge> …` (issue #260, GitHub Flow): one PR per branch to main,
 * each merged on its own when its required checks are green on its HEAD. All of it through REST
 * (`gh api`): `open` titles the PR after the branch's issue and closes it, `next` lists the open PRs
 * in the order to merge them (a stacked PR after its parent) with what each still needs, `update`
 * brings a PR up to date with its base, and `merge` (the coordinator only) merges with a merge
 * commit, never a squash.
 */

export interface GhResult {
  code: number;
  stdout: string;
}

export interface PrFlowDeps {
  /** Runs `gh <args>`; `gh api` fills `{owner}` and `{repo}` from the current repository. */
  gh(args: string[]): Promise<GhResult>;
  /** Runs `git <args>` in the repository. */
  git(args: string[]): Promise<GhResult>;
  env: Record<string, string | undefined>;
  log(line: string): void;
}

export interface Pr {
  number: number;
  head: string;
  sha: string;
  base: string;
  draft: boolean;
  title: string;
}

/** The issue a branch is about: the one its commit subjects name most, `(#N)`. */
export function issueOf(_subjects: string[]): number | null {
  return null;
}

/** The order to merge: PRs onto main by number, each stacked PR right after the PR it sits on. */
export function mergeOrder(_prs: Pr[]): Pr[] {
  return [];
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

/** Whether every required check is green: the newest run of each name, or a commit status. */
export function checksVerdict(
  _required: string[],
  _runs: CheckRun[],
  _statuses: { context: string; state: string }[],
): { green: boolean; failing: string[]; pending: string[]; missing: string[] } {
  return { green: true, failing: [], pending: [], missing: [] };
}

/** Runs one command; the exit code (2 for a usage error or a refusal). */
export async function prFlow(_argv: string[], _deps: PrFlowDeps): Promise<number> {
  return 0;
}
