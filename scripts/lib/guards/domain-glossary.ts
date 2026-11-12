/**
 * Issue #1600: every domain folder has a glossary entry. The folders of a domain are named from
 * `docs/GLOSSARY.md` (the "Domains" section), so a new folder with a word nobody wrote down fails.
 * A folder named after a layer instead of a domain (`server/`, `store/`) is in a baseline that only
 * shrinks, each with the issue that renames it.
 */

/** Where domain folders live: one folder per domain under each root. */
export const DOMAIN_ROOTS = [
  "apps/daemon/src",
  "apps/desktop/src/features",
  "packages/protocol/src",
];

/** A folder that is not named after a domain yet, and the issue that renames or regroups it. */
export interface LayerFolder {
  name: string;
  issue: number;
}

/** Only shrinks: a folder leaves it when it is renamed, or when it gets a glossary entry. */
export const LAYER_FOLDERS: LayerFolder[] = [
  // The WebSocket transport and the command handlers: they move to the domains they serve (#1594).
  { name: "server", issue: 1594 },
  // The SQLite schema and the event store: each domain's tables go to that domain's adapter (#1601).
  { name: "store", issue: 1601 },
  // An abbreviation: the background sessions of `claude --bg` go to `sessions/` (#1594).
  { name: "bg", issue: 1594 },
];

const byName = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

const ROW = /^\|\s*`([^`]+)`\s*\|/;

/** The folder names listed in the "Domains" section of the glossary (first column, in backticks). */
export function glossaryDomains(markdown: string): Set<string> {
  const names = new Set<string>();
  let inside = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) inside = line.trim() === "## Domains";
    const name = inside ? ROW.exec(line)?.[1] : undefined;
    if (name) names.add(name);
  }
  return names;
}

/** The domain folders under each root, as `root/name`; a root that does not exist adds none. */
export function domainFolders(roots: string[], list: (dir: string) => string[] | null): string[] {
  return roots.flatMap((root) => (list(root) ?? []).sort(byName).map((name) => `${root}/${name}`));
}

export interface DomainCheck {
  /** Folders with no glossary entry and not in the baseline. */
  missing: string[];
  /** Baseline names that no longer exist as a folder, or that now have an entry. */
  stale: string[];
}

export function checkDomains(
  folders: string[],
  glossary: Set<string>,
  baseline: string[],
): DomainCheck {
  const names = new Set(folders.map((folder) => folder.slice(folder.lastIndexOf("/") + 1)));
  const held = new Set(baseline);
  return {
    missing: folders.filter((folder) => {
      const name = folder.slice(folder.lastIndexOf("/") + 1);
      return !glossary.has(name) && !held.has(name);
    }),
    stale: baseline.filter((name) => !names.has(name) || glossary.has(name)),
  };
}
