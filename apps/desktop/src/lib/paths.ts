/** Last path segment, for both `/` and `\` separators. */
export const basename = (path: string): string => path.split(/[\\/]/).findLast(Boolean) ?? path;

/** `path` without trailing `/` or `\` separators. */
export function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return path.slice(0, end);
}

/** Whether `folder` is `root` or below it, as written (case counts, either separator). */
export function holdsFolder(root: string, folder: string): boolean {
  const base = trimTrailingSeparators(root);
  return folder === base || folder.startsWith(`${base}/`) || folder.startsWith(`${base}\\`);
}

/** Whether `path` is `root` or inside it; ignores case and treats `\` as `/`. */
export const isInside = (path: string, root: string): boolean => {
  const norm = (p: string) => trimTrailingSeparators(p.replaceAll("\\", "/")).toLowerCase();
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
    const above = steps.at(-1)?.path ?? root;
    steps.push({ name: part, path: `${trimTrailingSeparators(above)}${sep}${part}` });
  }
  return steps;
}
