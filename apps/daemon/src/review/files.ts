import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type FileEntry, type FileListing, inSequence } from "@flightdeck/protocol";
import { git } from "../board/command.ts";
import { refArg } from "../board/ref-arg.ts";
import { must } from "../board/worktree.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import { credential } from "../permissions/sensitive-paths.ts";
import { readRegularSized } from "../read-regular.ts";
import { ulid } from "../ulid.ts";
import type { Changes } from "./changes.ts";
import { firstStep, isGitDir, type Located, located, refuseCredential } from "./paths.ts";

/** What a path that cannot be looked at reads as. */
const absent = () => null;

/** The most entries one folder sends to the explorer; it says the rest were cut. */
const LIST_CAP = 500;

/**
 * Folders first, then files; numbers in names in their order (`file2` before `file10`), letters
 * without regard to case first, so two names of one folder never tie.
 */
function folderOrder(a: FileEntry, b: FileEntry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, "en", { numeric: true });
}

/**
 * What an entry is, links followed: `null` for a link that leaves the repository or leads nowhere,
 * and for anything that is neither a folder nor a file.
 */
async function entryTarget(
  realRoot: string,
  path: string,
  entry: Dirent,
): Promise<{ path: string; kind: FileEntry["kind"] } | null> {
  if (!entry.isSymbolicLink()) {
    if (entry.isDirectory()) return { path, kind: "dir" };
    return entry.isFile() ? { path, kind: "file" } : null;
  }
  const real = await realpath(path).catch(absent);
  // Out of the repository, or into its `.git`: not an entry of the explorer.
  if (!real || !isInside(realRoot, real) || isGitDir(firstStep(relative(realRoot, real)))) {
    return null;
  }
  // Gone since it was resolved: left out like a link that leads nowhere.
  const info = await stat(real).catch(absent);
  if (info?.isDirectory()) return { path: real, kind: "dir" };
  return info?.isFile() ? { path: real, kind: "file" } : null;
}

export interface ReviewFilesOptions {
  changes: Changes;
  /** Reverted files are copied to `<dataDir>/review-trash/`. */
  dataDir: string;
  /** Reverting and writing only inside these (reading works for any target). */
  allowedRoots: readonly string[];
  now?: () => number;
}

export interface FileContent {
  path: string;
  text: string;
  /** sha256 of the bytes, hex: what `write` expects back. */
  hash: string;
  size: number;
}

/** Only text files up to this size are read or written. */
const MAX_BYTES = 1024 * 1024;
/** How long a revert can be undone. */
const UNDO_MS = 30_000;
/** Copies of reverted files stay this long in the trash. */
const TRASH_MS = 7 * 86_400_000;

/** The file's bytes, or `null` when it is not there. */
const bytesOrNull = (path: string) => readFile(path).catch(() => null);

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

interface Undo {
  /** Where the copy went; `null` when the file did not exist before the revert. */
  copy: string | null;
  at: number;
}

/** Revert and edit, file by file, in the folder of a session or card. */
export class ReviewFiles {
  private readonly now: () => number;
  private readonly undos = new Map<string, Undo>();

  constructor(readonly opts: ReviewFilesOptions) {
    this.now = opts.now ?? Date.now;
  }

  async read(target: string, path: string): Promise<FileContent> {
    const { root } = await this.opts.changes.resolve(target);
    // Any target can be read, inside allowedRoots or not, but only inside its own repository.
    const where = await located(root, await realpath(root), path);
    refuseCredential(where, path);
    // The resolved path, opened without following a link: one swapped in after the check is refused.
    const read = where.real ? await readRegularSized(where.real, MAX_BYTES + 1) : null;
    if (!read) {
      throw new FlightdeckError("not_found", `${path} does not exist`, "review_file_missing", {
        path,
      });
    }
    const bytes = read.data;
    if (read.size > MAX_BYTES) {
      throw new FlightdeckError(
        "bad_request",
        `${path} is over 1 MB: edit it outside Flightdeck`,
        "review_file_big",
        { path },
      );
    }
    if (bytes.includes(0)) {
      throw new FlightdeckError("bad_request", `${path} is not text`, "review_file_binary", {
        path,
      });
    }
    return { path, text: bytes.toString("utf8"), hash: sha256(bytes), size: bytes.length };
  }

  /**
   * One folder of the repository for the file explorer (issue #506): folders first, then files, in
   * natural order. `.git` and links that leave the repository stay out; a credential is marked.
   */
  async list(target: string, dir: string): Promise<FileListing> {
    const { root } = await this.opts.changes.resolve(target);
    const realRoot = await realpath(root);
    const folder = dir === "" ? realRoot : (await located(root, realRoot, dir)).real;
    // `located` resolved it, so it is there.
    const info = folder ? await stat(folder) : null;
    if (!folder || !info?.isDirectory()) {
      throw new FlightdeckError("not_found", `${dir} is not a folder`, "review_file_missing", {
        path: dir,
      });
    }
    const entries: FileEntry[] = [];
    await inSequence(await readdir(folder, { withFileTypes: true }), async (entry) => {
      if (isGitDir(entry.name)) return;
      const real = await entryTarget(realRoot, join(folder, entry.name), entry);
      if (!real) return;
      const asked = dir === "" ? entry.name : `${dir}/${entry.name}`;
      const secret = credential(asked) || credential(relative(realRoot, real.path));
      entries.push({ name: entry.name, kind: real.kind, ...(secret ? { secret } : {}) });
    });
    entries.sort(folderOrder);
    return { dir, entries: entries.slice(0, LIST_CAP), truncated: entries.length > LIST_CAP };
  }

  /** Writes only when the file still has `expectedHash`; otherwise `file_conflict`. */
  async write(
    target: string,
    path: string,
    text: string,
    expectedHash: string,
  ): Promise<Omit<FileContent, "text">> {
    const where = await this.writable(target, path);
    refuseCredential(where, path);
    const { full } = where;
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length > MAX_BYTES) {
      throw new FlightdeckError("bad_request", "the text is over 1 MB", "review_text_big");
    }
    const before = await bytesOrNull(full);
    if ((before ? sha256(before) : null) !== expectedHash) {
      throw new FlightdeckError(
        "file_conflict",
        `${path} changed since it was opened`,
        "review_file_changed",
        { path },
      );
    }
    await writeFile(full, bytes);
    return { path, hash: sha256(bytes), size: bytes.length };
  }

  /**
   * Back to HEAD (the base, in a card), or removed when the source does not have it. A copy of
   * what was there goes to the trash first, and the revert can be undone for 30 s.
   */
  async revert(
    target: string,
    path: string,
    confirm: boolean,
  ): Promise<{ path: string; undoUntil: string }> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "confirm the revert with confirm: true",
        "review_revert_confirm",
      );
    }
    const { root, base } = await this.opts.changes.resolve(target);
    const { full } = await this.writable(target, path);
    await this.pruneTrash();
    let copy: string | null = null;
    if (await exists(full)) {
      copy = join(this.trash, ulid(this.now()), path);
      await mkdir(dirname(copy), { recursive: true });
      await copyFile(full, copy);
    }
    const source = base ?? "HEAD";
    const gitPath = path.replaceAll("\\", "/");
    const inSource = await git(root, "cat-file", "-e", `${refArg(source)}:${gitPath}`);
    if (inSource.code === 0) {
      must(
        await git(
          root,
          "restore",
          `--source=${refArg(source)}`,
          "--staged",
          "--worktree",
          "--",
          gitPath,
        ),
        "git restore",
      );
    } else {
      await rm(full, { force: true });
      must(await git(root, "rm", "-q", "--cached", "--ignore-unmatch", "--", gitPath), "git rm");
    }
    const at = this.now();
    this.undos.set(`${target}\0${path}`, { copy, at });
    return { path, undoUntil: new Date(at + UNDO_MS).toISOString() };
  }

  /** Puts back what the revert replaced, within 30 s of it. */
  async undoRevert(target: string, path: string, confirm: boolean): Promise<{ path: string }> {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "confirm the undo with confirm: true",
        "review_undo_confirm",
      );
    }
    const key = `${target}\0${path}`;
    const undo = this.undos.get(key);
    if (!undo || this.now() - undo.at > UNDO_MS) {
      throw new FlightdeckError(
        "invalid_state",
        `nothing to undo in ${path}`,
        "review_undo_nothing",
        { path },
      );
    }
    const { full } = await this.writable(target, path);
    if (undo.copy) {
      await mkdir(dirname(full), { recursive: true });
      await copyFile(undo.copy, full);
    } else {
      await rm(full, { force: true });
    }
    // The revert staged the source's version (or the removal): the index goes back to HEAD.
    const { root } = await this.opts.changes.resolve(target);
    await git(root, "reset", "-q", "--", path.replaceAll("\\", "/"));
    this.undos.delete(key);
    return { path };
  }

  private get trash(): string {
    return join(this.opts.dataDir, "review-trash");
  }

  /** Copies older than 7 days leave the trash. */
  private async pruneTrash(): Promise<void> {
    const names = await readdir(this.trash).catch(() => []);
    await inSequence(names, async (name) => {
      const dir = join(this.trash, name);
      const info = await stat(dir).catch(() => null);
      if (info && this.now() - info.mtimeMs > TRASH_MS)
        await rm(dir, { recursive: true, force: true });
    });
  }

  /**
   * A file that may be changed: the repository inside allowedRoots, and the file itself (links
   * resolved) still inside the repository.
   */
  private async writable(target: string, path: string): Promise<Located> {
    const { root } = await this.opts.changes.resolve(target);
    return located(root, await resolveAllowedCwd(root, this.opts.allowedRoots), path);
  }
}
