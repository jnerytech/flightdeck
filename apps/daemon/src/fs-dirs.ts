import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isInside, resolveAllowedCwd } from "./paths.ts";

export interface DirEntry {
  name: string;
  /** The real path: what `fs.dirs` takes again and what a session or project is created in. */
  path: string;
}

export interface DirListing {
  /** The folder listed, as a real path; null for the list of the allowed roots. */
  path: string | null;
  /** The folder above it inside the allowed roots; null at a root or at the list of roots. */
  parent: string | null;
  dirs: DirEntry[];
  /** True when the folder has more subfolders than `cap`. */
  truncated: boolean;
}

export interface ListDirsOptions {
  hidden?: boolean;
  /** The most subfolders returned (500 by default). */
  cap?: number;
}

const DEFAULT_CAP = 500;

/** The real path of a folder, or null when it is missing, not a folder or a broken link. */
function realDir(path: string): string | null {
  try {
    const real = realpathSync.native(path);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

const byName = (a: DirEntry, b: DirEntry) => {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (x === y) return a.name < b.name ? -1 : 1;
  return x < y ? -1 : 1;
};

/**
 * The subfolders of `path` (the allowed roots themselves without one), never outside the roots:
 * the path is resolved with realpath first, and a link is only listed when what it points to is
 * inside a root too. Files and, unless asked, hidden folders stay out.
 */
export function listDirs(
  path: string | undefined,
  allowedRoots: readonly string[],
  options: ListDirsOptions = {},
): DirListing {
  const roots = [
    ...new Set(allowedRoots.map(realDir).filter((root): root is string => root !== null)),
  ];
  if (path === undefined) {
    const dirs = roots.map((root) => ({ name: basename(root) || root, path: root }));
    return { path: null, parent: null, dirs, truncated: false };
  }
  const real = resolveAllowedCwd(path, allowedRoots);
  const dirs: DirEntry[] = [];
  for (const entry of readdirSync(real, { withFileTypes: true })) {
    if (!options.hidden && entry.name.startsWith(".")) continue;
    const child = join(real, entry.name);
    const target = entry.isDirectory() ? child : entry.isSymbolicLink() ? realDir(child) : null;
    if (target !== null && roots.some((root) => isInside(root, target))) {
      dirs.push({ name: entry.name, path: target });
    }
  }
  dirs.sort(byName);
  const cap = options.cap ?? DEFAULT_CAP;
  const above = dirname(real);
  const parent =
    roots.includes(real) || !roots.some((root) => isInside(root, above)) ? null : above;
  return { path: real, parent, dirs: dirs.slice(0, cap), truncated: dirs.length > cap };
}
