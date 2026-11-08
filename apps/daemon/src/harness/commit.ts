/**
 * Issue #75, slice C1: commits what the harness apply wrote on a new branch the host names. The
 * commit is made through a temporary index (`read-tree HEAD`, a blob per file, `write-tree`,
 * `commit-tree`), so the person's branch, index and files stay as they are, and every git call runs
 * with no hook, fsmonitor or gpg of the repository. See docs/decisions/2026-11-08-harness-commit.md.
 */
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessCommitted, SecretScanner } from "@flightdeck/protocol";
import { type CommandResult, killTree, runCommand } from "../board/command.ts";
import { refArg } from "../board/ref-arg.ts";
import { readInside } from "../create-inside.ts";
import { FlightdeckError } from "../errors.ts";
import { samePath } from "../paths.ts";
import { SAFE, TIMEOUT_MS } from "../teleport/git.ts";
import { whichOnPath } from "../which.ts";
import { MAX_FILE, SETTINGS } from "./preview.ts";
import { plainName, unvetted } from "./templates-store.ts";

export interface CommitDeps {
  /** The host's scanner (the vault's values among them): a commit is one push from public. */
  scanner: Pick<SecretScanner, "scan">;
  now?: () => Date;
}

/**
 * The files a setup writes: the settings, CLAUDE.md, and an agent or a skill under a plain name (a
 * template's, #75 T1b). Nothing else can be committed this way: never a `.env`, a hidden name or `..`.
 */
function setupFile(name: string): boolean {
  if (name === SETTINGS || name === "CLAUDE.md") return true;
  const agent = /^\.claude\/agents\/([^/]+)\.md$/.exec(name)?.[1];
  const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(name)?.[1];
  const plain = agent ?? skill;
  return plain !== undefined && plainName(plain);
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

const stale = () =>
  refuse("harness_commit_stale", "the files are not as the setup wrote them: apply again");

/** One git call in the repository, with no hook, fsmonitor or gpg of it. */
function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): Promise<CommandResult> {
  // git-arg: every revision here is HEAD, a value git gave, or the host's own branch through refArg.
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
  env: Record<string, string> = {},
  input?: string,
): Promise<string> {
  const result = await git(cwd, args, env, input);
  if (result.code !== 0) {
    throw new FlightdeckError("internal", `git ${args[0]} failed`, "harness_commit_git");
  }
  return result.stdout.trim();
}

/** `flightdeck/claude-setup-<yyyymmdd-hhmm>`, in UTC. */
function branchName(at: Date): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `flightdeck/claude-setup-${stamp}`;
}

/**
 * The files the setup wrote, as it wrote them: only the setup's own paths, each a plain file inside
 * the project with the digest apply gave. Anything else refuses with `harness_commit_stale`.
 */
async function filesAsWritten(
  root: string,
  digests: Readonly<Record<string, string>>,
): Promise<Array<[string, string]>> {
  const names = Object.keys(digests);
  if (names.length === 0 || names.some((name) => !setupFile(name))) throw stale();
  const files: Array<[string, string]> = [];
  // Plain reads of different files: together, then judged one by one (every miss is the same refusal).
  const texts = await Promise.all(names.map((name) => readInside(root, name, MAX_FILE)));
  for (const [i, name] of names.entries()) {
    const text = texts[i] ?? null;
    if (text === null || sha256(text) !== digests[name]) throw stale();
    files.push([name, text]);
  }
  return files;
}

/** The person's own identity: they will push this branch. Refused when the repository has none. */
async function identity(root: string): Promise<Record<string, string>> {
  const name = (await git(root, ["config", "user.name"])).stdout.trim();
  const email = (await git(root, ["config", "user.email"])).stdout.trim();
  if (!name || !email) {
    throw refuse(
      "harness_commit_identity",
      "git has no user.name and user.email for this repository: set them, then commit",
    );
  }
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/** Commits the files apply wrote (by their digests) on a new branch; the person's checkout stays. */
export async function commitHarness(
  path: string,
  digests: Readonly<Record<string, string>>,
  deps: CommitDeps,
): Promise<HarnessCommitted> {
  // `path` is real (the server resolved it inside the allowed roots): it must still be.
  const real = await realpath(path).catch(() => "");
  if (!samePath(real, path)) throw stale();
  const files = await filesAsWritten(path, digests);
  for (const [name, text] of files) {
    if (deps.scanner.scan(text).length > 0) {
      throw refuse("harness_commit_secret", `${name} holds a secret: it is not committed`, {
        file: name,
      });
    }
    // An agent or a skill on disk may never have come through a setup: vetted as a template's is.
    const part = name.startsWith(".claude/agents/") ? "agents" : "skills";
    if (name.startsWith(".claude/") && name !== SETTINGS && unvetted(part, text) !== null) {
      throw refuse(
        "harness_commit_withheld",
        `${name} could run a command or grant a permission: it is not committed`,
        { file: name },
      );
    }
  }
  const head = await git(path, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  const prefix = await git(path, ["rev-parse", "--show-prefix"]);
  if (head.code !== 0 || prefix.code !== 0) {
    throw refuse("harness_commit_no_head", "the project has no commit to start a branch from");
  }
  const parent = head.stdout.trim();
  const at = prefix.stdout.trim();
  // A file the person keeps out of git (local-only settings) is never committed for them.
  for (const [name] of files) {
    const checking = git(path, ["check-ignore", "-q", "--", name]);
    const ignored = (await checking).code; // NOSONAR: one git at a time, and the first ignored file is the one named
    if (ignored === 0) {
      throw refuse(
        "harness_commit_ignored",
        `${name} is ignored by git here: it is not committed`,
        {
          file: name,
        },
      );
    }
    // 1 is "not ignored"; anything else is git failing to say, which commits nothing.
    if (ignored !== 1) {
      throw new FlightdeckError("internal", "git check-ignore failed", "harness_commit_git");
    }
  }
  const author = await identity(path);
  const branch = refArg(branchName(deps.now?.() ?? new Date()));
  const scratch = await mkdtemp(join(tmpdir(), "fd-harness-commit-"));
  try {
    const index = { GIT_INDEX_FILE: join(scratch, "index") };
    await must(path, ["read-tree", parent], index);
    for (const [name, text] of files) {
      // From the bytes checked, with no clean filter of the repository (one can run a command).
      const hashing = must(path, ["hash-object", "-w", "--no-filters", "--stdin"], {}, text);
      const blob = await hashing; // NOSONAR: each file is added to the one index in turn
      // A file HEAD has as executable stays so; anything else is a plain file.
      const listing = must(path, ["ls-files", "-s", "--", name], index);
      const known = await listing; // NOSONAR: the index is read and then written file by file
      const mode = known.startsWith("100755 ") ? "100755" : "100644";
      const adding = must(
        path,
        ["update-index", "--add", "--cacheinfo", `${mode},${blob},${at}${name}`],
        index,
      );
      await adding; // NOSONAR: the one index takes one file at a time
    }
    const tree = await must(path, ["write-tree"], index);
    const message = `Set up Claude Code\n\nWritten by Flightdeck: ${files.map(([name]) => name).join(", ")}`;
    const commit = await must(
      path,
      ["commit-tree", "--no-gpg-sign", tree, "-p", parent, "-m", message],
      author,
    );
    const ref = `refs/heads/${branch}`;
    // git-arg: `ref` is the host's own branch name, through refArg; nothing of the app's goes in it.
    if ((await git(path, ["show-ref", "--verify", "-q", ref])).code === 0) {
      throw refuse("harness_commit_branch_taken", `the branch ${branch} is already there`, {
        branch,
      });
    }
    // The old value all zeros: made only if no branch has that name, even one made just now. Any
    // other failure (a branch named like a folder of this one, a lock) is git's own.
    await must(path, ["update-ref", ref, commit, "0".repeat(parent.length)]);
    return { branch, commit, files: files.map(([name]) => name) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
