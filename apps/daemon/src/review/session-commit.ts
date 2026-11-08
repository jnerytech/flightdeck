/**
 * Issue #1133, slice D1: commits a plain session's chosen uncommitted files on a new branch, in the
 * person's own checkout and with their git hooks, so the checkout ends on the new branch with those
 * files committed. Only what the person saw goes in (by digest); staged work they did not pick, a
 * merge or a rebase in progress, and a secret refuse before anything moves. A hook that fails leaves
 * the person on the new branch with their files and index as they were, and names the way back.
 * See docs/decisions/2026-11-08-session-commit.md.
 */
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdtemp,
  open,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  byCodeUnit,
  type ChangesCommitted,
  inSequence,
  type SecretScanner,
} from "@flightdeck/protocol";
import { type CommandResult, killTree, runCommand } from "../board/command.ts";
import { assertBranchName, refArg } from "../board/ref-arg.ts";
import type { DiffFile } from "../board/types.ts";
import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import type { Changes } from "./changes.ts";

export interface SessionCommitDeps {
  changes: Pick<Changes, "resolve" | "get">;
  /** The host's scanner (the vault's values among them): the branch is one push from public. */
  scanner: Pick<SecretScanner, "scan">;
  /** Whether `root` is a card's worktree: the board owns that branch, never this commit. */
  isCardWorktree: (root: string) => boolean;
  /** How long one git call (a hook included) may run; 120 s when absent. */
  timeoutMs?: number;
  /** Runs after the files are checked, before git reads them: a seam for a test that changes one. */
  afterCheck?: () => Promise<void>;
}

export interface SessionCommitInput {
  /** Each chosen path and the digest `changes.get` gave for it. */
  files: Readonly<Record<string, string>>;
  message: string;
  branch: string;
}

const TIMEOUT_MS = 120_000;
/** A chosen file is read whole for the secret scan: past this, it is refused instead. */
const MAX_SCAN = 8 * 1024 * 1024;
/** The end of a failed hook's output that the refusal carries. */
const MAX_OUTPUT = 2000;
/** Not defined on Windows: there the lstat before the open stands alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
/** A regular file opens at once either way; this only keeps a file swapped for a pipe from blocking. */
const NON_BLOCK = constants.O_NONBLOCK ?? 0;

/** Git as the person runs it (their hooks too), with no prompt and paths taken as written. */
const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1" };

const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

const stale = () =>
  refuse("changes_commit_stale", "the files changed since they were shown: look again");

/** The digest of a file over the size a commit checks: it is never read to make one. */
export const TOO_LARGE = "too-large";

/** A file in the working tree as it is now: the sha256 of its bytes, `deleted`, or `too-large`. */
export async function fileDigest(root: string, path: string): Promise<string> {
  const full = join(root, path);
  const info = await lstat(full).catch(() => null);
  if (info === null) return "deleted";
  const hash = createHash("sha256");
  // A link is what it points at as text, never the file it reaches.
  if (info.isSymbolicLink()) return hash.update(`link\0${await readlink(full)}`).digest("hex");
  if (!info.isFile()) return hash.update(`other\0${info.mode}`).digest("hex");
  // Never read whole on a refresh: a commit refuses it anyway.
  if (info.size > MAX_SCAN) return TOO_LARGE;
  for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * The session's files with the digest of each uncommitted one. A file that may hold a credential
 * is never read (#509): it gets none, so it can never be chosen.
 */
export async function withDigests(root: string, files: DiffFile[]): Promise<DiffFile[]> {
  const out: DiffFile[] = [];
  // One at a time: a tree of new files must not open them all at once.
  await inSequence(files, async (file) => {
    const read = file.uncommitted && file.secret !== true;
    out.push(read ? { ...file, digest: await fileDigest(root, file.path) } : file);
  });
  return out;
}

/** A chosen file as it was read: its bytes, or a link's text. */
interface Read {
  data: Buffer;
  link: boolean;
}

/**
 * A chosen file's bytes as they are now, read once through a handle that does not follow a link
 * and is sized by that handle: a link's text, null when the file is gone, or too large to read.
 */
async function bytesOf(root: string, path: string): Promise<Read | null | "too large" | "other"> {
  const full = join(root, path);
  const info = await lstat(full).catch(() => null);
  if (info === null) return null;
  if (info.isSymbolicLink()) return { data: Buffer.from(await readlink(full), "utf8"), link: true };
  // A pipe or a device is never opened: an open of a pipe with no writer never returns.
  if (!info.isFile()) return "other";
  const handle = await open(full, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK).catch(() => null);
  if (handle === null) return "other";
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return "other";
    if (stat.size > MAX_SCAN) return "too large";
    return { data: await handle.readFile(), link: false };
  } finally {
    await handle.close();
  }
}

/**
 * The hooks a commit from the app runs: the commit's own, and those the new branch's switch, the
 * ref update and the index write run; then `pre-push`, which the PR's push runs.
 */
const COMMIT_HOOKS = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "post-checkout",
  "reference-transaction",
  "post-index-change",
  "pre-push",
];

/**
 * The commit hooks a commit of the checkout at `root` runs: those present (and executable, outside
 * Windows) in the folder git takes them from, which accounts for `core.hooksPath` and a linked
 * worktree. The person sees them before confirming a commit.
 */
export async function commitHooks(root: string): Promise<string[] | undefined> {
  const found = await runCommand(
    [whichOnPath("git") ?? "git", "rev-parse", "--git-path", "hooks"],
    root,
    undefined,
    TIMEOUT_MS,
    killTree,
    ENV,
  );
  // Unknown, never "none": the person must not read a failed look as no hook at all.
  if (found.code !== 0) return undefined;
  const folder = resolve(root, found.stdout.trim());
  const out: string[] = [];
  for (const name of COMMIT_HOOKS) {
    const info = await stat(join(folder, name)).catch(() => null);
    const runs = process.platform === "win32" || ((info?.mode ?? 0) & 0o111) !== 0;
    if (info?.isFile() && runs) out.push(name);
  }
  return out;
}

/** Which operation is half done in the checkout, if any: a commit now would mix into it. */
async function inProgress(gitDir: string): Promise<string | null> {
  const marks: Array<[string, string]> = [
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ];
  for (const [mark, state] of marks) {
    if (
      await lstat(join(gitDir, mark)).then(
        () => true,
        () => false,
      )
    )
      return state;
  }
  return null;
}

/** The commits of plain sessions, and the branch each started from (the PR's base, D2). */
export class SessionCommits {
  /** What each new branch started from and the commit made on it, when this daemon made it. */
  private readonly made = new Map<string, { base: string | null; commit: string }>();
  /** The commit running in each checkout: a second one waits for it (a double click, two windows). */
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(readonly deps: SessionCommitDeps) {}

  private git(root: string, args: string[], input?: string): Promise<CommandResult> {
    // git-arg: every branch here went through assertBranchName and refArg; paths follow `--`.
    return runCommand(
      [whichOnPath("git") ?? "git", ...args],
      root,
      input,
      this.deps.timeoutMs ?? TIMEOUT_MS,
      killTree,
      ENV,
    );
  }

  private async must(root: string, args: string[]): Promise<string> {
    const result = await this.git(root, args);
    if (result.code !== 0) {
      throw new FlightdeckError("internal", `git ${args[0]} failed`, "changes_commit_git");
    }
    return result.stdout.trim();
  }

  async commit(target: string, input: SessionCommitInput): Promise<ChangesCommitted> {
    if (!target.startsWith("session:")) {
      throw refuse("changes_commit_target", "only a plain session's changes are committed here");
    }
    const { root } = await this.deps.changes.resolve(target);
    if (this.deps.isCardWorktree(root)) {
      throw refuse("changes_commit_target", "a card's worktree is committed by its card");
    }
    // Keyed by the real folder: two paths to one checkout share one line.
    const key = await realpath(root).catch(() => root);
    const prior = this.running.get(key) ?? Promise.resolve();
    const run = prior.then(
      () => this.commitIn(root, target, input),
      () => this.commitIn(root, target, input),
    );
    const tail: Promise<unknown> = run.then(
      () => undefined,
      () => undefined,
    );
    this.running.set(key, tail);
    // The last one done takes its entry away: the map never grows with old checkouts.
    void tail.then(() => {
      if (this.running.get(key) === tail) this.running.delete(key);
    });
    return run;
  }

  private async commitIn(
    root: string,
    target: string,
    input: SessionCommitInput,
  ): Promise<ChangesCommitted> {
    const branch = assertBranchName(input.branch);
    if (this.deps.scanner.scan(input.message).length > 0) {
      throw refuse(
        "changes_commit_message_secret",
        "the message holds a secret: nothing was committed",
      );
    }
    const gitDir = await this.must(root, ["rev-parse", "--absolute-git-dir"]);
    const state = await inProgress(gitDir);
    if (state !== null) {
      throw refuse("changes_commit_state", `a ${state} is in progress: finish it first`, { state });
    }
    const chosen = await this.chosen(target, input.files);
    const paths = [...new Set(chosen.flatMap((file) => [file.path, file.oldPath ?? []].flat()))];
    await this.noOtherStaged(root, paths);
    const expected = await this.checked(root, chosen, input.files);
    await this.deps.afterCheck?.();
    const taken = await this.git(root, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${refArg(branch)}`,
    ]);
    if (taken.code === 0) {
      throw refuse("changes_commit_branch_taken", `the branch ${branch} is already there`, {
        branch,
      });
    }
    const head = await this.git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const base = head.code === 0 ? head.stdout.trim() : null;
    const commit = await this.onNewBranch(root, branch, base, paths, input.message, expected);
    this.made.set(`${root}\0${branch}`, { base, commit });
    return {
      branch,
      base,
      commit,
      files: chosen.map((file) => file.path).sort(byCodeUnit),
    };
  }

  /** The branch `branch` was made from in the checkout at `root`, when this daemon made it. */
  baseOf(root: string, branch: string): string | null {
    return this.made.get(`${root}\0${branch}`)?.base ?? null;
  }

  /** The commit this daemon made on `branch` in the checkout at `root`: what its PR pushes (D2). */
  commitOf(root: string, branch: string): string | null {
    return this.made.get(`${root}\0${branch}`)?.commit ?? null;
  }

  /** The chosen files, each still uncommitted and as the person saw it (its digest). */
  private async chosen(
    target: string,
    sent: Readonly<Record<string, string>>,
  ): Promise<DiffFile[]> {
    const { files } = await this.deps.changes.get(target);
    const byPath = new Map(files.map((file) => [file.path, file]));
    const out: DiffFile[] = [];
    for (const [path, digest] of Object.entries(sent)) {
      const file = byPath.get(path);
      // A file that may hold a credential (`.env`) is never committed from the app.
      if (file?.secret === true) {
        throw refuse(
          "changes_commit_secret",
          `${path} may hold a credential: it is not committed`,
          {
            file: path,
          },
        );
      }
      if (file?.digest === TOO_LARGE) {
        throw refuse("changes_commit_too_large", `${path} is too large to check for secrets`, {
          file: path,
        });
      }
      if (file === undefined || !file.uncommitted || file.digest !== digest) throw stale();
      out.push(file);
    }
    if (out.length === 0) throw stale();
    return out;
  }

  /** Work the person staged and did not pick would be left half staged: refused. */
  private async noOtherStaged(root: string, paths: string[]): Promise<void> {
    const staged = await this.must(root, ["diff", "--cached", "--name-only", "--no-renames", "-z"]);
    const picked = new Set(paths);
    if (staged.split("\0").some((path) => path !== "" && !picked.has(path))) {
      throw refuse("changes_commit_state", "other files are staged: commit or unstage them first", {
        state: "staged",
      });
    }
  }

  /**
   * Each chosen file read once: the bytes hashed against what the person saw are the bytes scanned,
   * and the ones the commit must hold (null for a deleted file). A link is its text, never followed.
   */
  private async checked(
    root: string,
    chosen: DiffFile[],
    sent: Readonly<Record<string, string>>,
  ): Promise<Map<string, Read | null>> {
    const out = new Map<string, Read | null>();
    for (const file of chosen) {
      const bytes = await bytesOf(root, file.path);
      if (bytes === "other") throw stale();
      if (bytes === "too large") {
        throw refuse("changes_commit_too_large", `${file.path} is too large to check for secrets`, {
          file: file.path,
        });
      }
      const digest =
        bytes === null
          ? "deleted"
          : createHash("sha256")
              .update(bytes.link ? `link\0${bytes.data.toString("utf8")}` : bytes.data)
              .digest("hex");
      if (digest !== sent[file.path]) throw stale();
      if (bytes !== null && this.deps.scanner.scan(bytes.data.toString("utf8")).length > 0) {
        throw refuse(
          "changes_commit_secret",
          `${file.path} holds a secret: nothing was committed`,
          {
            file: file.path,
          },
        );
      }
      out.set(file.path, bytes);
      // A rename's old path goes into the commit as gone: it must be gone now, and stay gone.
      if (file.oldPath) {
        if ((await lstat(join(root, file.oldPath)).catch(() => null)) !== null) throw stale();
        out.set(file.oldPath, null);
      }
    }
    return out;
  }

  /**
   * The paths whose committed content is not the bytes checked: a hook that reformats a file, or a
   * session still writing, changed it between the check and git's read. Each is hashed by git with
   * the path's own filters.
   */
  private async rewritten(
    root: string,
    expected: Map<string, Read | null>,
    scratch: string,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const [path, read] of expected) {
      // `<mode> <type> <id>\t<path>`, or nothing when the commit does not hold the path.
      const entry = (await this.must(root, ["ls-tree", "HEAD", "--", path])).split(/\s+/);
      if (read === null) {
        if (entry[0] !== "") out.push(path);
        continue;
      }
      // A link checked as a link, a file as a file: a swap of one for the other is a change.
      if ((entry[0] === "120000") !== read.link) {
        out.push(path);
        continue;
      }
      const blob = join(scratch, "blob");
      await writeFile(blob, read.data);
      const hashed = read.link
        ? await this.git(root, ["hash-object", "--no-filters", "--", blob])
        : await this.git(root, ["hash-object", `--path=${path}`, "--", blob]);
      if (hashed.code !== 0 || hashed.stdout.trim() !== entry[2]) out.push(path);
    }
    return out.sort(byCodeUnit);
  }

  /**
   * The new branch and the commit, with the person's hooks. A failure after the switch puts the
   * index back as it was and leaves the person on the new branch, with their files untouched.
   */
  private async onNewBranch(
    root: string,
    branch: string,
    base: string | null,
    paths: string[],
    message: string,
    expected: Map<string, Read | null>,
  ): Promise<string> {
    const index = resolve(root, await this.must(root, ["rev-parse", "--git-path", "index"]));
    const keep = await mkdtemp(join(tmpdir(), "fd-commit-index-"));
    const copy = join(keep, "index");
    const hadIndex = await copyFile(index, copy).then(
      () => true,
      () => false,
    );
    // The commit the branch starts on (none in a repository with no commit yet): an undo goes there,
    // and from a detached checkout it is the way back.
    const before = await this.git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    const start = before.code === 0 ? before.stdout.trim() : null;
    const back = base ?? start ?? "";
    try {
      const switched = await this.git(root, ["switch", "-q", "-c", refArg(branch)]);
      if (switched.code !== 0) {
        throw new FlightdeckError("internal", "git switch failed", "changes_commit_git");
      }
      // `commit -- <paths>` takes changes, deletions and renames from the tree as it is; a new file
      // must be known to git first. Only those on disk are added: a deleted path has nothing to add.
      const onDisk: string[] = [];
      for (const path of paths) {
        if (
          await lstat(join(root, path)).then(
            () => true,
            () => false,
          )
        )
          onDisk.push(path);
      }
      const added = onDisk.length === 0 ? null : await this.git(root, ["add", "--", ...onDisk]);
      const made =
        added === null || added.code === 0
          ? await this.git(root, ["commit", "-q", "-F", "-", "--", ...paths], message)
          : added;
      const putBack = async () => {
        // Through a new file renamed in place: a link put where the index was is replaced, not followed.
        if (!hadIndex) return rm(index, { force: true });
        const next = `${index}.fd-restore`;
        await copyFile(copy, next);
        await rename(next, index);
      };
      if (made.code !== 0 || made.timedOut) {
        await putBack();
        throw this.refused(made, branch, back);
      }
      const changed = await this.rewritten(root, expected, keep);
      if (changed.length > 0) {
        // Undone: the branch back on the commit it started from, the index as it was.
        const undo =
          start !== null
            ? await this.git(root, ["reset", "-q", "--soft", start])
            : await this.git(root, ["update-ref", "-d", "HEAD"]);
        if (undo.code !== 0) {
          throw new FlightdeckError(
            "internal",
            "a file changed during the commit, and the commit could not be undone",
            "changes_commit_git",
          );
        }
        await putBack();
        throw refuse(
          "changes_commit_rewritten",
          "a hook or the session changed files while they were committed: look again, then commit",
          { files: changed.join(", ") },
        );
      }
      return await this.must(root, ["rev-parse", "HEAD"]);
    } finally {
      await rm(keep, { recursive: true, force: true });
    }
  }

  /**
   * Why the commit was refused, with the way back: out of time, or what git and the hooks said (its
   * end only), or not that when it holds a secret.
   */
  private refused(result: CommandResult, branch: string, base: string): FlightdeckError {
    const where = { branch, base };
    if (result.timedOut) {
      return refuse("changes_commit_timeout", "the commit ran out of time", where);
    }
    // Scanned whole, then cut: a cut could split a secret and hide it from the scanner.
    const said = `${result.stderr}\n${result.stdout}`.trim();
    if (this.deps.scanner.scan(said).length > 0) {
      return refuse("changes_commit_hook_withheld", "the commit was refused", where);
    }
    return refuse("changes_commit_hook", "the commit was refused", {
      output: said.slice(-MAX_OUTPUT),
      ...where,
    });
  }
}
