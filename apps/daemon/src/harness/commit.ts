/**
 * Issue #75, slice C1: commits what the harness apply wrote on a new branch the host names. The
 * commit is made through a temporary index (`read-tree HEAD`, a blob per file, `write-tree`,
 * `commit-tree`), so the person's branch, index and files stay as they are, and every git call runs
 * with no hook, fsmonitor or gpg of the repository. See docs/decisions/2026-11-08-harness-commit.md.
 */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { HarnessCommitted, SecretScanner } from "@flightdeck/protocol";
import { commitBase, commitOnNewBranch, readInside, safeGit } from "../board/index.ts";
import { FlightdeckError, HEAD, refArg, samePath } from "../kernel/index.ts";
import { harnessRefusal, refuse, setupFile, stale } from "./domain/commit-rules.ts";
import { SETTINGS } from "./domain/settings-proposal.ts";
import { unvetted } from "./domain/template-vetting.ts";
import { MAX_FILE } from "./preview.ts";

export interface CommitDeps {
  /** The host's scanner (the vault's values among them): a commit is one push from public. */
  scanner: Pick<SecretScanner, "scan">;
  now?: () => Date;
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

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
