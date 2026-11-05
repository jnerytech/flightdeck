/**
 * The size of the repository's Markdown files, locked: a file over its line limit must be in
 * md-size-baseline.json, which only goes down (`overBaseline` of the layout ratchet). Agents read
 * these files whole, and a long file is also one more place every branch appends to.
 */

/** The line limit of a tracked Markdown file. */
export function mdLimit(path: string): number {
  if (/(^|\/)CLAUDE\.md$/.test(path) || /^\.claude\/(rules|agents)\//.test(path)) return 150;
  if (/(^|\/)SKILL\.md$/.test(path)) return 300;
  return 400;
}

/** The files over their limit, with their line counts. */
export function oversized(files: { path: string; text: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path, text } of files) {
    const n = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (n > mdLimit(path)) counts[path] = n;
  }
  return counts;
}
