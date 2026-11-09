import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { laggingBranches } from "../lib/demo-lagging.ts";
import { realTempDir } from "./temp-dir.ts";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

/** A repository like the demo's billing project: one commit on main with its README. */
function billingRepo(): { repo: string; worktrees: string } {
  const root = realTempDir("fd-demo-billing-");
  cleanups.push(root);
  const repo = join(root, "billing");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "demo@flightdeck.local");
  git(repo, "config", "user.name", "Demo");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# billing\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "inicial");
  return { repo, worktrees: join(root, "worktrees") };
}

/** How many commits the worktree has that main lacks, and the other way round. */
const aheadBehind = (path: string) => {
  const out = execFileSync("git", ["rev-list", "--left-right", "--count", "HEAD...main"], {
    cwd: path,
  })
    .toString()
    .trim()
    .split(/\s+/)
    .map(Number);
  return { ahead: out[0], behind: out[1] };
};

/** What a rebase onto main does to a worktree, as the host's updateFromBase runs it. */
const rebased = (path: string): string => {
  try {
    git(path, "rebase", "main");
    return "updated";
  } catch {
    git(path, "rebase", "--abort");
    return "rebase_conflict";
  }
};

/**
 * #1406: the demo's billing cards lag behind main, so the journey can update three of them and see
 * one conflict. Checked with a plain `git rebase main`, the rebase card.updateFromBase runs, so the
 * test pulls no daemon module under the coverage gate of a changed test's imports (#762).
 */
describe("demo-lagging: branches behind main, the last in conflict (#1406)", () => {
  test("each branch lags one commit behind main; two rebase cleanly and the last conflicts", () => {
    const { repo, worktrees } = billingRepo();
    const made = laggingBranches(git, repo, worktrees, 3);
    const before = made.map((m) => aheadBehind(m.path));
    const outcomes = made.map((m) => rebased(m.path));
    expect({
      branches: made.map((m) => m.branch),
      before,
      outcomes,
    }).toEqual({
      branches: ["fd/atualizar-1", "fd/atualizar-2", "fd/atualizar-3"],
      before: [
        { ahead: 1, behind: 1 },
        { ahead: 1, behind: 1 },
        { ahead: 1, behind: 1 },
      ],
      outcomes: ["updated", "updated", "rebase_conflict"],
    });
  });
});
