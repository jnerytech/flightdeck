import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { specPathProblem } from "@flightdeck/protocol";
import { isInside } from "../paths.ts";

/** What the daemon learns of a card's spec file: that it is there, and its first heading. */
export interface SpecFound {
  found: boolean;
  heading: string | null;
}

const NOTHING: SpecFound = { found: false, heading: null };

/** How much of the start of the file is looked at for a heading. */
const LOOKED_AT = 8192;
const HEADING_MAX = 120;

/** Where a test can change the folder between the checks and the open. */
export interface SpecHooks {
  beforeOpen?(): Promise<void>;
}

/**
 * Looks for the spec file `path` (relative, Markdown) in the worktree `root`. Only two things
 * leave: whether a regular, non-empty file is there and the first heading in its first 8 KiB; the
 * contents never do. `path` is refused unless it is plain (`specPathProblem`); the file must not be
 * a link nor have a second name (a hard link may point outside), and once its folders are resolved
 * it must be inside the worktree's real path. It is opened without following a link or waiting on
 * a pipe, and the file opened must be the one that was checked (same device and inode) and, where
 * the system says where a descriptor points, still inside. Anything else is "not there": the
 * answer does not tell what exists beyond the worktree.
 */
export async function readSpec(
  root: string,
  path: string,
  hooks: SpecHooks = {},
): Promise<SpecFound> {
  if (root === "" || specPathProblem(path) !== null) return NOTHING;
  try {
    const realRoot = await realpath(root);
    const target = resolve(realRoot, path);
    const info = await lstat(target);
    if (!info.isFile() || info.size === 0 || info.nlink > 1) return NOTHING;
    // A folder on the way may be a link: where the file really is must still be inside.
    if (!isInside(realRoot, await realpath(target))) return NOTHING;
    await hooks.beforeOpen?.();
    // O_NOFOLLOW stops a link at the file; O_NONBLOCK stops the wait on a pipe put there instead.
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await handle.stat();
      // A folder on the way swapped for a link after the check leads to another file.
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) return NOTHING;
      if (!(await descriptorInside(realRoot, handle.fd))) return NOTHING;
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(LOOKED_AT), 0, LOOKED_AT, 0);
      const text = buffer.subarray(0, bytesRead);
      return { found: true, heading: firstHeading(text, bytesRead === LOOKED_AT) };
    } finally {
      await handle.close();
    }
  } catch {
    return NOTHING;
  }
}

/** Where an open descriptor really points, where the system tells (Linux): still inside the root. */
async function descriptorInside(realRoot: string, fd: number): Promise<boolean> {
  if (process.platform !== "linux") return true;
  const where = await realpath(`/proc/self/fd/${fd}`).catch(() => null);
  return where === null || isInside(realRoot, where);
}

/** What a heading must not carry: controls, invisible and direction-changing characters, breaks. */
const NOT_FOR_A_HEADING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** The first ATX heading of the start of a file, plain text of at most 120 characters. */
function firstHeading(bytes: Buffer, cut: boolean): string | null {
  const lines = bytes.toString("utf8").split(/\r?\n/);
  // A start that ended mid-line has a last line that may be half a heading.
  if (cut) lines.pop();
  for (const line of lines) {
    // `.` stops at U+2028 and U+2029; a line here ends only at a line feed.
    const match = /^ {0,3}#{1,6}[ \t]+([^\n]*)$/.exec(line);
    if (!match) continue;
    const text = withoutClosing(match[1] ?? "").replace(NOT_FOR_A_HEADING, "");
    if (text !== "") return Array.from(text).slice(0, HEADING_MAX).join("");
  }
  return null;
}

/** `Title ##` is `Title`; `C#` keeps its hash. Walks the line once. */
function withoutClosing(text: string): string {
  const trimmed = text.trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end -= 1;
  const separated = end === 0 || trimmed[end - 1] === " " || trimmed[end - 1] === "\t";
  return (end < trimmed.length && separated ? trimmed.slice(0, end) : trimmed).trimEnd();
}
