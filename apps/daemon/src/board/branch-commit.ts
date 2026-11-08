/**
 * A commit of a few files on a new branch, made through a temporary index (`read-tree`, a blob per
 * file, `write-tree`, `commit-tree`, `update-ref`): the person's branch, index and files stay as they
 * are, and every git call runs with no hook, fsmonitor or gpg of the repository. Shared by the
 * harness setup (#75, docs/decisions/2026-11-08-harness-commit.md) and the workflow templates
 * (#1221). Each caller names its own refusals.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlightdeckError } from "../errors.ts";
import { SAFE, TIMEOUT_MS } from "../teleport/git.ts";
import { whichOnPath } from "../which.ts";
import { type CommandResult, killTree, runCommand } from "./command.ts";
import type { Rev } from "./ref-arg.ts";

/** What can go wrong, each refused by the caller under its own reason. */
export type BranchCommitFailure = "no_head" | "identity" | "branch_taken" | "git";

export type Refuse = (
  failure: BranchCommitFailure,
  params?: Record<string, string>,
) => FlightdeckError;

/** One git call in the repository, with no hook, fsmonitor or gpg of it. */
export function safeGit(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): Promise<CommandResult> {
  // git-arg: every caller passes HEAD, a value git gave, or a branch through refArg.
  return runCommand(
    [whichOnPath("git") ?? "git", ...SAFE, ...args],
    cwd,
    input,
    TIMEOUT_MS,
    killTree,
    env,
  );
}

async function must(
  cwd: string,
  args: string[],
  refuse: Refuse,
  env: Record<string, string> = {},
  input?: string,
): Promise<string> {
  const result = await safeGit(cwd, args, env, input);
  if (result.code !== 0) throw refuse("git", { command: args[0] ?? "" });
  return result.stdout.trim();
}

/** Where the commit starts: the parent's id and the project's folder inside the repository. */
export interface CommitBase {
  parent: string;
  /** `--show-prefix`: empty at the repository's root, else the project's folder with a `/`. */
  prefix: string;
}

/**
 * The commit `rev` names (`HEAD`, or a branch through `refArg`) and the project's place in its
 * repository; `no_head` when there is none to start from.
 */
export async function commitBase(repo: string, rev: Rev, refuse: Refuse): Promise<CommitBase> {
  // git-arg: `rev` went through refArg (or is HEAD), so it never starts with `-`.
  const head = await safeGit(repo, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
  const prefix = await safeGit(repo, ["rev-parse", "--show-prefix"]);
  if (head.code !== 0 || prefix.code !== 0) throw refuse("no_head");
  return { parent: head.stdout.trim(), prefix: prefix.stdout.trim() };
}

/** The person's own identity: they will push this branch. Refused when the repository has none. */
async function identity(repo: string, refuse: Refuse): Promise<Record<string, string>> {
  const name = (await safeGit(repo, ["config", "user.name"])).stdout.trim();
  const email = (await safeGit(repo, ["config", "user.email"])).stdout.trim();
  if (!name || !email) throw refuse("identity");
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/**
 * Commits `files` (paths from the project's folder, with their text) on top of `base.parent` and
 * makes `branch` point at it, only if no branch has that name. Returns the commit.
 */
export async function commitOnNewBranch(
  repo: string,
  opts: {
    base: CommitBase;
    files: ReadonlyArray<readonly [string, string]>;
    message: string;
    /** The host's own name for it, through `refArg`. */
    branch: string;
    refuse: Refuse;
  },
): Promise<string> {
  const { base, files, message, branch, refuse } = opts;
  const author = await identity(repo, refuse);
  const scratch = await mkdtemp(join(tmpdir(), "fd-branch-commit-"));
  try {
    const index = { GIT_INDEX_FILE: join(scratch, "index") };
    await must(repo, ["read-tree", base.parent], refuse, index);
    for (const [name, text] of files) {
      // From the bytes checked, with no clean filter of the repository (one can run a command).
      const hashing = must(
        repo,
        ["hash-object", "-w", "--no-filters", "--stdin"],
        refuse,
        {},
        text,
      );
      const blob = await hashing; // NOSONAR: each file is added to the one index in turn
      // A file the parent has as executable stays so; anything else is a plain file.
      const listing = must(repo, ["ls-files", "-s", "--", name], refuse, index);
      const known = await listing; // NOSONAR: the index is read and then written file by file
      const mode = known.startsWith("100755 ") ? "100755" : "100644";
      const adding = must(
        repo,
        ["update-index", "--add", "--cacheinfo", `${mode},${blob},${base.prefix}${name}`],
        refuse,
        index,
      );
      await adding; // NOSONAR: the one index takes one file at a time
    }
    const tree = await must(repo, ["write-tree"], refuse, index);
    const commit = await must(
      repo,
      ["commit-tree", "--no-gpg-sign", tree, "-p", base.parent, "-m", message],
      refuse,
      author,
    );
    const ref = `refs/heads/${branch}`;
    // git-arg: `ref` is the host's own branch name, through refArg; nothing of the app's goes in it.
    if ((await safeGit(repo, ["show-ref", "--verify", "-q", ref])).code === 0) {
      throw refuse("branch_taken", { branch });
    }
    // The old value all zeros: made only if no branch has that name, even one made just now. Any
    // other failure (a branch named like a folder of this one, a lock) is git's own.
    await must(repo, ["update-ref", ref, commit, "0".repeat(base.parent.length)], refuse);
    return commit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
