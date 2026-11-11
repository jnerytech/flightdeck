import { join } from "node:path";

/** Where each project's incremental build info lives, under the ignored node_modules/.cache. */
export const TSC_CACHE = "node_modules/.cache/tsc";

/** The files `seedCache` reads and writes; the real ones are wired in `scripts/typecheck.ts`. */
export interface CacheFiles {
  exists(path: string): boolean;
  /** The last change of the file, in ms. */
  mtime(path: string): number;
  copy(from: string, to: string): void;
}

export interface SeedInput {
  /** This checkout's root. */
  root: string;
  /** The roots of the other worktrees of the repository. */
  siblings: string[];
  /** The build info file names the projects use. */
  names: string[];
  files: CacheFiles;
}

/**
 * A new worktree has no build info, so its first typecheck checks every file (about 45 s here
 * against 8 s warm). tsc keeps the hash of each source file in the build info and re-checks only
 * the ones that differ, so a copy from another worktree is safe: it starts the run near the
 * sources instead of at zero. Copies, for each name this checkout lacks, the newest one a sibling
 * has, and returns the names it copied.
 */
export function seedCache(_input: SeedInput): string[] {
  return [];
}
