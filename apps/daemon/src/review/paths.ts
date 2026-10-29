import { isAbsolute, join } from "node:path";
import { FlightdeckError } from "../errors.ts";

/**
 * A file of the review, given relative to the repository: never absolute, never above the root
 * and never inside `.git`. Returns the full path.
 */
export function fileInRoot(root: string, path: string): string {
  const segments = path.split(/[\\/]/);
  if (isAbsolute(path) || segments.includes("..") || segments[0] === ".git" || path === "") {
    throw new FlightdeckError("bad_request", `caminho fora do repositório: ${path}`);
  }
  return join(root, path);
}

/** Lines of a text, without the line breaks (a last empty line does not count). */
export const linesOf = (text: string) => text.replace(/\r?\n$/, "").split(/\r?\n/);
