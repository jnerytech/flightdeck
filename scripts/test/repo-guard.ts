/**
 * Guard against a test writing into the repository the suite runs in: a worktree path that fell
 * back to "" makes a `git` call or a write land in the current folder. The head and the working
 * tree are noted before the run and compared after it.
 */
export interface RepoGuard {
  root: string;
  head: string;
  status: string;
  /** The repository's own config (`git config --local --list`), `core.bare` among it. */
  config: string;
}

function git(root: string, ...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

/** Notes the head and the working tree of the repository at `root`; `null` when it is not one. */
export function installRepoGuard(root: string): RepoGuard | null {
  const head = git(root, "rev-parse", "HEAD");
  const status = git(root, "status", "--porcelain", "--untracked-files=all");
  const config = git(root, "config", "--local", "--list");
  return head === null || status === null || config === null
    ? null
    : { root, head, status, config };
}

/** What differs between two config listings, with `core.bare` called out by name. */
function configChanges(before: string, after: string): string[] {
  const was = new Set(before.split("\n"));
  const is = new Set(after.split("\n"));
  const lines = [
    ...[...is].filter((line) => line !== "" && !was.has(line)).map((line) => `+ ${line}`),
    ...[...was].filter((line) => line !== "" && !is.has(line)).map((line) => `- ${line}`),
  ];
  if (lines.length === 0) return [];
  const bare = lines.some((line) => line.includes("core.bare")) ? " (core.bare changed)" : "";
  return [`git config of the repository changed${bare}:`, ...lines.map((line) => `  ${line}`)];
}

/** Throws when the repository's head or working tree is not what it was. */
export function assertRepoUntouched(guard: RepoGuard | null): void {
  if (!guard) return;
  const head = git(guard.root, "rev-parse", "HEAD");
  const status = git(guard.root, "status", "--porcelain", "--untracked-files=all") ?? "";
  const before = new Set(guard.status.split("\n"));
  const changed = status.split("\n").filter((line) => line !== "" && !before.has(line));
  const gone = guard.status.split("\n").filter((line) => line !== "" && !status.includes(line));
  const config = git(guard.root, "config", "--local", "--list") ?? "";
  const problems = [
    ...configChanges(guard.config, config),
    ...(head !== guard.head ? [`head ${guard.head.slice(0, 8)} -> ${head?.slice(0, 8)}`] : []),
    ...changed,
    ...gone.map((line) => `(was) ${line}`),
  ];
  if (problems.length > 0) {
    throw new Error(`a test wrote into the repository ${guard.root}:\n  ${problems.join("\n  ")}`);
  }
}

/** Throws when PATH is not what it was: a fake CLI left on it slows or misleads every later test. */
export function assertPathUntouched(before: string | undefined): void {
  if (process.env.PATH !== before) {
    throw new Error(
      `PATH changed during the run: a test left a fake on it (was ${before}, is ${process.env.PATH})`,
    );
  }
}
