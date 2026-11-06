import { stat } from "node:fs/promises";

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
