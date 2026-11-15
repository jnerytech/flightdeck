import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../../src/git/adapters/git.ts";
import type { WorktreeCard } from "../../src/worktrees/domain/cleanup-rules.ts";
import { FolderLocks } from "../../src/worktrees/domain/locks.ts";
import { Worktrees, type WorktreesOptions } from "../../src/worktrees/worktrees.ts";
import { git, gitRepo } from "../support/board-helpers.ts";

const DAY = 86_400_000;
export const MB = 1024 * 1024;
export const ID = ["-c", "user.email=a@b", "-c", "user.name=t"];

export interface Setup {
  repo: string;
  add(name: string, branch?: string): string;
  worktrees: Worktrees;
  options: WorktreesOptions;
  locks: FolderLocks;
}

export function setup(
  over: Partial<WorktreesOptions> = {},
  where: { repo: string } = gitRepo(),
  baseBranch = "main",
  cards: WorktreeCard[] = [],
): Setup {
  const { repo } = where;
  const locks = new FolderLocks();
  const add = (name: string, branch = `fd/${name}`) => {
    const path = join(repo, ".flightdeck", "worktrees", name);
    git(repo, "worktree", "add", "-q", "-b", branch, path, "main");
    return path;
  };
  const options: WorktreesOptions = {
    projects: () => [{ id: "p1", name: "api", path: repo, baseBranch }],
    cards: () => cards,
    busy: () => null,
    detach: () => {},
    git: (cwd, ...args) => run(cwd, ...args),
    size: async () => 5 * MB,
    disk: async () => null,
    now: () => Date.now() + 10 * DAY,
    locks,
    ...over,
  };
  return { repo, add, worktrees: new Worktrees(options), options, locks };
}

export const commitIn = (dir: string, file: string) => {
  writeFileSync(join(dir, file), "work");
  git(dir, "add", file);
  git(dir, ...ID, "commit", "-q", "-m", file);
};
export const branches = (repo: string) => git(repo, "branch", "--list", "fd/*");
export const blockersOf = async (s: Setup) =>
  Object.fromEntries((await s.worktrees.list()).worktrees.map((w) => [w.branch, w.blockers]));
