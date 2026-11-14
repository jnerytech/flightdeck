/** A session's folder as the history compares it (#1589): the same folder whatever the slashes. */

/** The path without the slashes (either kind) at its end: a loop, since a pattern backtracks on a long run. */
export function trimSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return path.slice(0, end);
}

/** The session's folder, or anything below it (never a look-alike prefix). */
export const CWD_CONDITION = String.raw`(s.cwd = $cwd OR substr(s.cwd, 1, length($cwd) + 1) IN ($cwd || '/', $cwd || '\'))`;

/** Comparable form of a folder: forward slashes, no trailing slash, case folded where the OS does. */
export function normalizeCwdFor(path: string, platform: string): string {
  const slashes = trimSlashes(path.replaceAll("\\", "/"));
  return platform === "win32" || platform === "darwin" ? slashes.toLowerCase() : slashes;
}
