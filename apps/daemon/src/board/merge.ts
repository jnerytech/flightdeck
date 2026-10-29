import { join } from "node:path";
import { FlightdeckError } from "../errors.ts";
import { ulid } from "../ulid.ts";
import { git } from "./command.ts";
import { must } from "./worktree.ts";

/** Commits of `HEAD` (in `worktree`) not in `base`, and of `base` not in `HEAD`. */
export async function aheadBehind(
  worktree: string,
  base: string,
): Promise<{ ahead: number; behind: number }> {
  const counted = must(
    await git(worktree, "rev-list", "--left-right", "--count", `${base}...HEAD`),
    "git rev-list",
  );
  const [behind, ahead] = counted.stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead ?? 0, behind: behind ?? 0 };
}

/** Merges go into a local branch: a remote ref or a deleted branch is refused. */
export async function assertLocalBranch(repo: string, base: string): Promise<void> {
  const local = await git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${base}`);
  if (local.code !== 0) {
    throw new FlightdeckError("invalid_state", `a base ${base} não é uma branch local`);
  }
}

/** Lines of `git status --porcelain`: what is not committed in a worktree. */
export async function pendingFiles(cwd: string): Promise<string[]> {
  const status = must(await git(cwd, "status", "--porcelain"), "git status");
  return status.stdout.split("\n").filter(Boolean);
}

/**
 * Rebases the worktree's branch on `base`, uncommitted changes stashed and put back. On a
 * conflict the rebase is aborted (which restores them) and the error lists the files.
 */
export async function rebaseOnto(worktree: string, base: string): Promise<void> {
  const rebase = await git(worktree, "rebase", "--autostash", base);
  if (rebase.code === 0) return;
  const conflicted = await git(worktree, "diff", "--name-only", "--diff-filter=U");
  await git(worktree, "rebase", "--abort");
  const files = conflicted.stdout.split("\n").filter(Boolean).join(", ");
  throw new FlightdeckError("invalid_state", `conflito ao atualizar com ${base}: ${files}`);
}

/** The worktree where `branch` is checked out, if any (`git worktree list --porcelain`). */
async function checkedOutAt(repo: string, branch: string): Promise<string | null> {
  const list = must(await git(repo, "worktree", "list", "--porcelain"), "git worktree list");
  for (const block of list.stdout.split(/\n\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && block.includes(`\nbranch refs/heads/${branch}`)) return path;
  }
  return null;
}

async function mergeIn(cwd: string, branch: string, mode: "merge" | "squash", message: string) {
  if (mode === "merge") {
    must(await git(cwd, "merge", "--no-ff", "-m", message, branch), "git merge");
    return;
  }
  must(await git(cwd, "merge", "--squash", branch), "git merge --squash");
  must(await git(cwd, "commit", "-m", message), "git commit");
}

/**
 * Merges `branch` into `base`. Conflicts are checked first with `git merge-tree`, which only
 * reads: nothing changes when there are any. Where the base is checked out, the merge happens
 * there, and only when that worktree is clean; otherwise in a temporary worktree of the base,
 * removed after. The base's ref is never moved by hand (`update-ref`), so a worktree that has it
 * checked out never falls behind its own HEAD.
 */
export async function mergeIntoBase(
  repo: string,
  base: string,
  branch: string,
  mode: "merge" | "squash",
  message: string,
): Promise<void> {
  const check = await git(
    repo,
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    base,
    branch,
  );
  if (check.code === 1) {
    const files = check.stdout.split("\n").slice(1).filter(Boolean).join(", ");
    throw new FlightdeckError("invalid_state", `conflito com ${base}: ${files}`);
  }
  must(check, "git merge-tree");
  const checkout = await checkedOutAt(repo, base);
  if (checkout) {
    const pending = await pendingFiles(checkout);
    if (pending.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `${base} está em checkout em ${checkout} com mudanças: ${pending.join(", ")}`,
      );
    }
    await mergeIn(checkout, branch, mode, message);
    return;
  }
  // Where card worktrees live: excluded from the repository's status.
  const temporary = join(repo, ".flightdeck", "worktrees", `merge-${ulid().toLowerCase()}`);
  must(await git(repo, "worktree", "add", "-q", temporary, base), "git worktree add");
  try {
    await mergeIn(temporary, branch, mode, message);
  } finally {
    await git(repo, "worktree", "remove", "--force", temporary);
  }
}
