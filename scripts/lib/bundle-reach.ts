/**
 * Which packages the app's entry point loads at start-up: the static imports reachable from it.
 * A package behind `import()` is not in the entry chunk, so a heavy one that shows up here is a
 * regression of the code split (phase 28, `bundle-lazy`).
 */

/** The module specifiers a source file imports at load time (type-only imports do not load). */
export function staticImports(_source: string): string[] {
  return ["?"];
}

/** The package a bare specifier belongs to (`@scope/name/sub` is `@scope/name`), else null. */
export function packageOf(_specifier: string): string | null {
  return "?";
}

export interface Reached {
  package: string;
  /** The files from the entry to the one that imports it. */
  via: string[];
}

/**
 * Follows the static imports from `entries` through the files under `srcRoot` (relative paths and
 * `@/` for `srcRoot`) and returns, for each package in `watched`, the first chain that reaches it.
 * A watched name ending in `/` stands for every package that starts with it.
 */
export function reachedPackages(
  _entries: string[],
  _srcRoot: string,
  _watched: string[],
): Reached[] {
  return [{ package: "?", via: [] }];
}
