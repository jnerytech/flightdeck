/** Comments blanked out, newlines kept, so a position keeps its line number. */
const withoutComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

/** The line (from 1) of each top-level block whose whole selector is `selector`. */
function topLevelBlocks(css: string, selector: string): number[] {
  const text = withoutComments(css);
  const lines: number[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      const head = text.slice(start, i);
      if (depth === 0 && head.trim() === selector) {
        const at = start + head.length - head.trimStart().length;
        lines.push(text.slice(0, at).split("\n").length);
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (char === ";" && depth === 0) {
      start = i + 1;
    }
  }
  return lines;
}

/**
 * A line describing what is wrong with the theme blocks of a stylesheet, or null when they are
 * right: exactly one top-level `:root { … }` block, and a top-level `.dark { … }` block after it.
 * A second `:root` after `.dark` has the same specificity and wins, painting the light tokens
 * over the dark ones.
 */
export function themeBlocksProblem(css: string): string | null {
  const roots = topLevelBlocks(css, ":root");
  if (roots.length === 0) return "no top-level :root block";
  if (roots.length > 1) {
    return `${roots.length} top-level :root blocks (lines ${roots.slice(0, -1).join(", ")} and ${roots[roots.length - 1]}): a later one overrides .dark`;
  }
  const dark = topLevelBlocks(css, ".dark");
  return dark.some((line) => line > (roots[0] as number))
    ? null
    : "no top-level .dark block after :root";
}
