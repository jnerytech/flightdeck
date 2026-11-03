import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
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
async function realDir(path: string): Promise<string | null> {
  try {
    const real = await realpath(path);
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** Where a link points when it points at a folder; anything that is not a link has no target. */
const linkTarget = async (entry: Dirent, child: string): Promise<string | null> =>
  entry.isSymbolicLink() ? await realDir(child) : null;

/** The real paths of the allowed roots that exist, each once. */
async function realRoots(allowedRoots: readonly string[]): Promise<string[]> {
  const found = await Promise.all(allowedRoots.map(realDir));
  return [...new Set(found.filter((root): root is string => root !== null))];
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
export async function listDirs(
  path: string | undefined,
  allowedRoots: readonly string[],
  options: ListDirsOptions = {},
): Promise<DirListing> {
  const roots = await realRoots(allowedRoots);
  if (path === undefined) {
    const dirs = roots.map((root) => ({ name: basename(root) || root, path: root }));
    return { path: null, parent: null, dirs, truncated: false };
  }
  const real = await resolveAllowedCwd(path, allowedRoots);
  const dirs: DirEntry[] = [];
  for (const entry of await readdir(real, { withFileTypes: true })) {
    if (!options.hidden && entry.name.startsWith(".")) continue;
    const child = join(real, entry.name);
    const target = entry.isDirectory() ? child : await linkTarget(entry, child);
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

export interface FileListing {
  path: string;
  files: DirEntry[];
  truncated: boolean;
}

const SKIPPED = new Set([".git", "node_modules"]);

/**
 * The files of `path` (a folder inside the allowed roots, resolved like `listDirs` does, so the
 * same refusals), sorted like the folders. A link is listed only when it points at a file inside a
 * root; hidden files only when asked; the inside of `.git` and `node_modules` never.
 */
export async function listFiles(
  path: string,
  allowedRoots: readonly string[],
  options: ListDirsOptions = {},
): Promise<FileListing> {
  const roots = await realRoots(allowedRoots);
  const real = await resolveAllowedCwd(path, allowedRoots);
  if (real.split(sep).some((part) => SKIPPED.has(part))) {
    return { path: real, files: [], truncated: false };
  }
  const files: DirEntry[] = [];
  for (const entry of await readdir(real, { withFileTypes: true })) {
    if (!options.hidden && entry.name.startsWith(".")) continue;
    const child = join(real, entry.name);
    let target: string | null = null;
    try {
      const resolved = entry.isSymbolicLink() ? await realpath(child) : child;
      target = (await stat(resolved)).isFile() ? resolved : null;
    } catch {
      target = null;
    }
    if (target !== null && roots.some((root) => isInside(root, target))) {
      files.push({ name: entry.name, path: target });
    }
  }
  files.sort(byName);
  const cap = options.cap ?? DEFAULT_CAP;
  return { path: real, files: files.slice(0, cap), truncated: files.length > cap };
}
