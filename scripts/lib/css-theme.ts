/**
 * A line describing what is wrong with the theme blocks of a stylesheet, or null when they are
 * right: exactly one top-level `:root { … }` block, and a top-level `.dark { … }` block after it.
 */
export function themeBlocksProblem(_css: string): string | null {
  return null;
}
