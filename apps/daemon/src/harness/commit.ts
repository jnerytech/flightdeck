/**
 * Issue #75, slice C1: commits what the harness apply wrote on a new branch the host names. The
 * commit is made through a temporary index (`read-tree HEAD`, a blob per file, `write-tree`,
 * `commit-tree`), so the person's branch, index and files stay as they are, and every git call runs
 * with no hook, fsmonitor or gpg of the repository. See docs/decisions/2026-11-08-harness-commit.md.
 */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { HarnessCommitted, SecretScanner } from "@flightdeck/protocol";
import {
  type BranchCommitFailure,
  commitBase,
  commitOnNewBranch,
  safeGit,
} from "../board/branch-commit.ts";
import { HEAD, refArg } from "../board/ref-arg.ts";
import { readInside } from "../create-inside.ts";
import { FlightdeckError } from "../errors.ts";
import { samePath } from "../paths.ts";
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

/** The shared branch commit's failures, under the harness's own reasons and words. */
function harnessRefusal(
  failure: BranchCommitFailure,
  params: Record<string, string> = {},
): FlightdeckError {
  switch (failure) {
    case "no_head":
      return refuse("harness_commit_no_head", "the project has no commit to start a branch from");
    case "identity":
      return refuse(
        "harness_commit_identity",
        "git has no user.name and user.email for this repository: set them, then commit",
      );
    case "branch_taken":
      return refuse(
        "harness_commit_branch_taken",
        `the branch ${params.branch ?? ""} is already there`,
        { branch: params.branch ?? "" },
      );
    case "git":
      return new FlightdeckError(
        "internal",
        `git ${params.command ?? ""} failed`,
        "harness_commit_git",
      );
  }
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
  const base = await commitBase(path, HEAD, harnessRefusal);
  // A file the person keeps out of git (local-only settings) is never committed for them.
  for (const [name] of files) {
    const checking = safeGit(path, ["check-ignore", "-q", "--", name]);
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
  const branch = refArg(branchName(deps.now?.() ?? new Date()));
  const message = `Set up Claude Code\n\nWritten by Flightdeck: ${files.map(([name]) => name).join(", ")}`;
  const commit = await commitOnNewBranch(path, {
    base,
    files,
    message,
    branch,
    refuse: harnessRefusal,
  });
  return { branch, commit, files: files.map(([name]) => name) };
}
