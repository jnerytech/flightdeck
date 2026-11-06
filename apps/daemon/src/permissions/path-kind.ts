import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * What a path is on disk, for the rule check (#395): a folder, a file, or missing (not there, or
 * under a file). A path it cannot look up (no access, a bad name) counts as a folder: that reading
 * refuses a rule rather than letting it cover what may be inside.
 */
export async function statKind(path: string): Promise<"dir" | "file" | "missing"> {
  try {
    return (await stat(path)).isDirectory() ? "dir" : "file";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "dir";
  }
}

/**
 * The real path of a path, behind every symlink (#528). A path not there yet is its parent's real
 * path plus its name; a link to nowhere, or a path it cannot look up, is null.
 */
export async function realPathOf(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") return null;
  }
  // Not there: a link to nowhere still names a place (a write would create it there), so refuse.
  const there = await lstat(path).then(
    () => true,
    () => false,
  );
  const parent = dirname(path);
  if (there || parent === path) return null;
  const up = await realPathOf(parent);
  return up === null ? null : join(up, basename(path));
}
