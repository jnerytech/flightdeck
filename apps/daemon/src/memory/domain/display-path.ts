/**
 * A path as the context screen shows it: with "/" on every platform, as Claude Code's own rules
 * and imports write theirs. `separator` is the platform's (callers pass `path.sep`), a parameter so the file imports no
 * `node:*` and a test can use Windows'.
 */
export function displayPath(path: string, separator: string): string {
  return separator === "\\" ? path.replaceAll("\\", "/") : path;
}
