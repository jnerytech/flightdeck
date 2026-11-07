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

/**
 * Looks for the spec file `path` (relative, Markdown) in the worktree `root`. Only two things
 * leave: whether a regular, non-empty file is there and the first heading in its first 8 KiB; the
 * contents never do. `path` is refused unless it is plain (`specPathProblem`), a link is never
 * followed (the file itself is not a link and, once its folders are resolved, it is still inside
 * the worktree's real path), and only a regular file is opened, without blocking. Anything else is
 * "not there": the answer does not tell what exists beyond the worktree.
 */
export async function readSpec(root: string, path: string): Promise<SpecFound> {
  if (root === "" || specPathProblem(path) !== null) return NOTHING;
  try {
    const realRoot = await realpath(root);
    const target = resolve(realRoot, path);
    const info = await lstat(target);
    if (!info.isFile() || info.size === 0) return NOTHING;
    // A folder on the way may be a link: where the file really is must still be inside.
    if (!isInside(realRoot, await realpath(target))) return NOTHING;
    // O_NOFOLLOW: a link swapped in after the check is refused by the system; O_NONBLOCK: so is
    // the wait on a pipe put there instead.
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      if (!(await handle.stat()).isFile()) return NOTHING;
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(LOOKED_AT), 0, LOOKED_AT, 0);
      return {
        found: true,
        heading: firstHeading(buffer.subarray(0, bytesRead), bytesRead === LOOKED_AT),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return NOTHING;
  }
}

/** The first ATX heading of the start of a file, plain text: no controls, at most 120 characters. */
function firstHeading(bytes: Buffer, cut: boolean): string | null {
  const lines = bytes.toString("utf8").split(/\r?\n/);
  // A start that ended mid-line has a last line that may be half a heading.
  if (cut) lines.pop();
  for (const line of lines) {
    const match = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$/.exec(line);
    if (!match) continue;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    const text = (match[1] ?? "").replace(/[ \t]+#+$/, "").replace(/[\u0000-\u001f\u007f]/g, "");
    if (text !== "") return Array.from(text).slice(0, HEADING_MAX).join("");
  }
  return null;
}
