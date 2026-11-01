import { sep } from "node:path";

/**
 * A path as the context screen shows it: with "/" on every platform, as Claude Code's own rules
 * and imports write theirs. `separator` is the platform's, a parameter so a test can use
 * Windows'.
 */
export function displayPath(path: string, separator: string = sep): string {
  return separator === "\\" ? path : path;
}
