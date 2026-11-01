/** Last path segment, for both `/` and `\` separators. */
export const basename = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** `path` without trailing `/` or `\` separators. */
export function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return path.slice(0, end);
}

/** Whether `path` is `root` or inside it; ignores case and treats `\` as `/`. */
export const isInside = (path: string, root: string): boolean => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const [a, r] = [norm(path), norm(root)];
  return a === r || a.startsWith(`${r}/`);
};

/** A root and each folder below it down to `path`, with the path each one opens. */
export function breadcrumbSteps(path: string, root: string): Array<{ name: string; path: string }> {
  const sep = root.includes("\\") ? "\\" : "/";
  // Below the root the path may be written in other letters (Windows): its length is the same.
  const rest = path.slice(trimTrailingSeparators(root).length).split(/[\\/]/).filter(Boolean);
  const steps = [{ name: basename(root), path: root }];
  for (const part of rest) {
    const above = steps[steps.length - 1]?.path ?? root;
    steps.push({ name: part, path: `${trimTrailingSeparators(above)}${sep}${part}` });
  }
  return steps;
}
