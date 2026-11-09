/**
 * Issue #1361: the rules a stored check command passes just before it runs unattended (the watch,
 * the check loop). Best effort, not a boundary: the gate is who can edit the list
 * (docs/decisions/2026-11-09-check-loop.md).
 */
import { posix, win32 } from "node:path";
import { isWatchCheck } from "@flightdeck/protocol";
import { ntfsName } from "../ntfs-name.ts";

/** Why a stored check command is not run. */
export type CheckRefusal = "not_plain" | "env_assignment" | "outside_worktree";

/**
 * Null when `command` may run in `worktree`, else why not: a shell would read more than a command
 * and its arguments, its first word assigns a variable, or a piece of a word leads outside.
 */
export function checkCommandRefusal(
  command: string,
  worktree: string,
  platform: string = process.platform,
): CheckRefusal | null {
  if (!isWatchCheck(command)) return "not_plain";
  const words = command.split(" ");
  if ((words[0] ?? "").includes("=")) return "env_assignment";
  const windows = platform === "win32";
  const outside = words
    .flatMap((word) => pieces(word, windows))
    .some((piece) => !inside(piece, worktree, windows));
  return outside ? "outside_worktree" : null;
}

/**
 * The parts of a word that can name a place: split on `=`, `,`, `@` and `:` (`--config=/etc/x`,
 * `a,/y`, `@/x`, `--x:/y`), plus the value of a short flag (`-I/etc`). On Windows a drive path is
 * read whole.
 */
function pieces(word: string, windows: boolean): string[] {
  const flag = /^-[A-Za-z](.+)$/.exec(word);
  const parts = flag?.[1] ? [word, flag[1]] : [word];
  return parts
    .flatMap((part) => part.split(/[=,@]/))
    .flatMap((part) => (windows && /^[A-Za-z]:/.test(part) ? [part] : part.split(":")))
    .filter((part) => part !== "");
}

/** Whether `piece`, read from the worktree, stays inside it; lexical: symlinks are not followed. */
function inside(piece: string, worktree: string, windows: boolean): boolean {
  if (!windows) {
    const rel = posix.relative(worktree, posix.resolve(worktree, piece));
    return rel === "" || (!rel.startsWith("..") && !posix.isAbsolute(rel));
  }
  // A drive-relative path (`C:x`) depends on that drive's current folder: never inside.
  if (/^[A-Za-z]:(?![\\/])/.test(piece)) return false;
  // Each step as NTFS reads it, case blind (2026-11-09-ntfs-names-in-path-checks.md).
  const steps = (path: string) =>
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .map(ntfsName);
  const root = steps(win32.resolve(worktree));
  const target = steps(win32.resolve(worktree, piece));
  return target.length >= root.length && root.every((step, i) => step === target[i]);
}
