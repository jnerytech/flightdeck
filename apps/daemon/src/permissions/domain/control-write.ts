/**
 * Issue #3614: a write to a file the host or a tool runs on its own (a hook, the session's settings, a
 * script, the CI) is high risk, because a session that may write one runs code later with no one asked.
 */
import { join, relative, resolve } from "node:path";
import { isInside } from "../../kernel/index.ts";
import { isControl } from "./sensitive-paths.ts";

/** The reason a person sees for such a write. */
export const CONTROL_WRITE = "writes a file the host or a tool runs";

/**
 * Whether `path` names a control file inside the cwd or one of the roots. It is read from the root down,
 * so a project that lives under `.claude/worktrees` is not held for every file it has; a path outside
 * every root is not judged here (a write there is high already).
 */
export function writesControlFile(
  path: string,
  cwd: string,
  roots: readonly string[],
  home: string,
): boolean {
  const expanded = /^~(?=$|[\\/])/.test(path) ? join(home, path.slice(1)) : path;
  const full = resolve(cwd, expanded);
  // The deepest root that holds the path, so a nested project is read from its own folder.
  const root = [cwd, ...roots]
    .map((r) => resolve(r))
    .filter((r) => isInside(r, full))
    .sort((a, b) => b.length - a.length)[0];
  return root !== undefined && isControl(relative(root, full));
}

/**
 * A redirect target is one shell word, read as bash reads it (`\` escapes the next character, so
 * `.g\it` is `.git`) and as Windows reads it (`\` separates), as `insideAny` does for the cwd.
 */
export const redirectsToControlFile = (target: string, cwd: string, home: string): boolean =>
  [target, target.replaceAll("\\", "/"), target.replaceAll("\\", "")].some((reading) =>
    writesControlFile(reading, cwd, [], home),
  );
