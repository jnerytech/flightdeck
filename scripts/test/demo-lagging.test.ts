import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aheadBehind, rebaseOnto } from "../../apps/daemon/src/board/merge.ts";
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

/** What the host's rebase says of a worktree: updated, or the reason it refused. */
const rebased = (path: string) =>
  rebaseOnto(path, "main").then(
    () => "updated",
    (error: { reason?: string }) => error.reason ?? "error",
  );

/**
 * #1406: the demo's billing cards lag behind main, so the journey can update three of them and see
 * one conflict. Checked with the host's own rebase (`rebaseOnto`), the one card.updateFromBase runs.
 */
describe("demo-lagging: branches behind main, the last in conflict (#1406)", () => {
  test("each branch lags one commit behind main; two rebase cleanly and the last conflicts", async () => {
    const { repo, worktrees } = billingRepo();
    const made = laggingBranches(git, repo, worktrees, 3);
    const before = await Promise.all(made.map((m) => aheadBehind(m.path, "main")));
    const outcomes: string[] = [];
    for (const m of made) outcomes.push(await rebased(m.path));
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
