/** Last path segment, for both `/` and `\` separators. */
export const basename = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** `path` without trailing `/` or `\` separators. */
export function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return path.slice(0, end);
}
