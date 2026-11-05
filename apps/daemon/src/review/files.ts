import { createHash } from "node:crypto";
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
import { dirname, join } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { git } from "../board/command.ts";
import { must } from "../board/worktree.ts";
import { FlightdeckError } from "../errors.ts";
import { isInside, resolveAllowedCwd } from "../paths.ts";
import { ulid } from "../ulid.ts";
import type { Changes } from "./changes.ts";
import { fileInRoot } from "./paths.ts";

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
    const full = fileInRoot(root, path);
    const bytes = await bytesOrNull(full);
    if (!bytes) {
      throw new FlightdeckError("not_found", `${path} does not exist`, "review_file_missing", {
        path,
      });
    }
    if (bytes.length > MAX_BYTES) {
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

  /** Writes only when the file still has `expectedHash`; otherwise `file_conflict`. */
  async write(
    target: string,
    path: string,
    text: string,
    expectedHash: string,
  ): Promise<Omit<FileContent, "text">> {
    const full = await this.writable(target, path);
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
    const full = await this.writable(target, path);
    await this.pruneTrash();
    let copy: string | null = null;
    if (await exists(full)) {
      copy = join(this.trash, ulid(this.now()), path);
      await mkdir(dirname(copy), { recursive: true });
      await copyFile(full, copy);
    }
    const source = base ?? "HEAD";
    const gitPath = path.replaceAll("\\", "/");
    const inSource = await git(root, "cat-file", "-e", `${source}:${gitPath}`);
    if (inSource.code === 0) {
      must(
        await git(root, "restore", `--source=${source}`, "--staged", "--worktree", "--", gitPath),
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
    const full = await this.writable(target, path);
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
  private async writable(target: string, path: string): Promise<string> {
    const { root } = await this.opts.changes.resolve(target);
    const realRoot = await resolveAllowedCwd(root, this.opts.allowedRoots);
    const full = fileInRoot(root, path);
    const real = await realpath(full).catch(() => null);
    if (real && !isInside(realRoot, real)) {
      throw new FlightdeckError(
        "forbidden_cwd",
        `${path} points outside the repository`,
        "review_path_link",
        { path },
      );
    }
    return full;
  }
}
