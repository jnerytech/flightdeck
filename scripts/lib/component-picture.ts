/**
 * Issue #1624: the C4 component level of the context map, generated from the import graph instead
 * of drawn by hand: every file collapsed to its domain folder, one edge per pair of domains. The
 * output is sorted, so an unchanged tree gives the same text. `scripts/component-picture.ts` feeds
 * it dependency-cruiser's modules and writes the file (`bun run arch:picture`).
 */

/** The part of a dependency-cruiser module this reads. */
export type PictureModule = { source: string; dependencies: { resolved: string }[] };

/** The domain a source file belongs to, as `<app>/<folder>`; null for a file outside the three packages. */
export function domainOf(_path: string): string | null {
  return "stub";
}

/** The generated decision file: one mermaid flowchart per app, domains as nodes and imports as edges. */
export function componentPicture(_modules: readonly PictureModule[]): string {
  return "";
}
