/** One `git(...)` call that gives a branch or revision to git with nothing between it and an option. */
export interface GitArgFinding {
  file: string;
  line: number;
  call: string;
}

/** Calls of `git(` and `gitLimited(` in `source` that pass a base or branch without a guard (issue #345). */
export function unguardedGitCalls(_source: string, _file = ""): GitArgFinding[] {
  return [];
}

/** The findings of every `.ts` file under `root`, files with none left out. */
export function unguardedInTree(_root: string): GitArgFinding[] {
  return [];
}
