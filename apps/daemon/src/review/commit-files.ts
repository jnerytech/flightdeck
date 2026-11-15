/**
 * The files of a session's working tree as the commit and the changes screen read them: the digest
 * of each one, its bytes right before a commit, and the hooks a commit would run. Nothing here
 * follows a link, opens a pipe or a device, reads a file over the limit or reads a file that may
 * hold a credential (#509). See docs/decisions/2026-11-08-session-commit.md.
 */
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, open, readlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type DiffFile, inSequence } from "@flightdeck/protocol";
import { killTree, runCommand, whichOnPath } from "../kernel/index.ts";
import {
  COMMIT_HOOKS,
  hooksThatRun,
  linkDigest,
  MAX_SCAN,
  otherDigest,
  type Read,
  TOO_LARGE,
} from "./domain/commit-digest.ts";

export const TIMEOUT_MS = 120_000;
/** Not defined on Windows: there the lstat before the open stands alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
/** A regular file opens at once either way; this only keeps a file swapped for a pipe from blocking. */
const NON_BLOCK = constants.O_NONBLOCK ?? 0;

/** Git as the person runs it (their hooks too), with no prompt and paths taken as written. */
export const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1" };

/** A file in the working tree as it is now: the sha256 of its bytes, `deleted`, or `too-large`. */
async function fileDigest(root: string, path: string): Promise<string> {
  const full = join(root, path);
  const info = await lstat(full).catch(() => null);
  if (info === null) return "deleted";
  // A link is what it points at as text, never the file it reaches.
  if (info.isSymbolicLink()) return linkDigest(await readlink(full));
  if (!info.isFile()) return otherDigest(info.mode);
  // Never read whole on a refresh: a commit refuses it anyway.
  if (info.size > MAX_SCAN) return TOO_LARGE;
  const hash = createHash("sha256");
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

/**
 * A chosen file's bytes as they are now, read once through a handle that does not follow a link
 * and is sized by that handle: a link's text, null when the file is gone, or too large to read.
 */
export async function bytesOf(
  root: string,
  path: string,
): Promise<Read | null | "too large" | "other"> {
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
  // Plain reads of different files: together, then kept in COMMIT_HOOKS' order.
  const infos = await Promise.all(
    COMMIT_HOOKS.map((name) => stat(join(folder, name)).catch(() => null)),
  );
  return hooksThatRun(infos, process.platform === "win32");
}
