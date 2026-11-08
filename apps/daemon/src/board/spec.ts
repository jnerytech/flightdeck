import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { specPathProblem } from "@flightdeck/protocol";
import { isInside } from "../paths.ts";

/** What the daemon learns of a card's spec file: that it is there, and its first heading. */
export interface SpecFound {
  found: boolean;
  heading: string | null;
  /** Only when the front matter says `draft: true`: the one value read from it (#78). */
  draft?: true;
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
    // BigInt: a 64-bit file id does not survive a Number.
    const info = await lstat(target, { bigint: true });
    if (!info.isFile() || info.size === 0n || info.nlink > 1n) return NOTHING;
    // A folder on the way may be a link: where the file really is must still be inside.
    if (!isInside(realRoot, await realpath(target))) return NOTHING;
    await hooks.beforeOpen?.();
    // O_NOFOLLOW stops a link at the file; O_NONBLOCK stops the wait on a pipe put there instead.
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = await handle.stat({ bigint: true });
      // A folder on the way swapped for a link after the check leads to another file.
      if (!opened.isFile() || opened.nlink !== 1n) return NOTHING;
      if (opened.dev !== info.dev || opened.ino !== info.ino) return NOTHING;
      if (!(await descriptorInside(realRoot, handle.fd))) return NOTHING;
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(LOOKED_AT), 0, LOOKED_AT, 0);
      // Where the system cannot say where the descriptor points, the path says it once more,
      // after the open: it must still be inside and still be the file that was opened.
      if (!(await stillThere(realRoot, target, opened))) return NOTHING;
      const { draft, body } = frontMatter(buffer.subarray(0, bytesRead).toString("utf8"));
      const heading = firstHeading(body, bytesRead === LOOKED_AT);
      return draft ? { found: true, heading, draft: true } : { found: true, heading };
    } finally {
      await handle.close();
    }
  } catch {
    return NOTHING;
  }
}

/**
 * Where an open descriptor really points, where the system tells (Linux): still inside the root.
 * A system that does not tell (no `/proc`, another system) is not asked; one that tells and fails
 * to answer for this descriptor is refused.
 */
export async function descriptorInside(
  realRoot: string,
  fd: number,
  procFds = "/proc/self/fd",
): Promise<boolean> {
  const tells = await stat(procFds).then(
    () => true,
    () => false,
  );
  if (!tells) return true;
  const where = await realpath(`${procFds}/${fd}`).catch(() => null);
  return where !== null && isInside(realRoot, where);
}

/** The path still leads, inside the root, to the very file that was opened. */
export async function stillThere(
  realRoot: string,
  target: string,
  opened: { dev: bigint; ino: bigint },
): Promise<boolean> {
  const now = await lstat(target, { bigint: true }).catch(() => null);
  if (now === null || now.dev !== opened.dev || now.ino !== opened.ino) return false;
  return isInside(realRoot, await realpath(target));
}

/** What a heading must not carry: controls, invisible and direction-changing characters, breaks. */
const NOT_FOR_A_HEADING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * A front matter block (`---` lines at the very start): whether it says `draft: true` (as YAML
 * writes it: any case, quoted or not), and the text after it, where the heading is looked for.
 * Nothing else of it is kept. A block that does not close within what was read counts as a draft:
 * the check fails closed.
 */
function frontMatter(text: string): { draft: boolean; body: string } {
  const block = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!block) return { draft: /^\uFEFF?---\r?\n/.test(text), body: text };
  return {
    draft: /^draft:[ \t]*(["']?)true\1[ \t]*\r?$/im.test(block[1] ?? ""),
    body: text.slice(block[0].length),
  };
}

/** The first ATX heading of the start of a file, plain text of at most 120 characters. */
function firstHeading(text: string, cut: boolean): string | null {
  const lines = text.split(/\r?\n/);
  // A start that ended mid-line has a last line that may be half a heading.
  if (cut) lines.pop();
  for (const line of lines) {
    // `.` stops at U+2028 and U+2029; a line here ends only at a line feed.
    const opener = /^ {0,3}#{1,6}[ \t]+/.exec(line);
    if (!opener) continue;
    // A tab separates words; the other controls and invisible characters just go.
    const text = withoutClosing(line.slice(opener[0].length).replaceAll("\t", " ")).replace(
      NOT_FOR_A_HEADING,
      "",
    );
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
