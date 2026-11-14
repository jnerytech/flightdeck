/**
 * The projects domain's public entry (#1594): the folders a host allows (its allowed roots, never
 * a system folder), the git repositories found under them, and cloning one into a root. Another
 * domain imports from here, never a file inside.
 */

export type { PlatformInfo } from "./domain/system-folders.ts";
export { allowedRoot, cloneRepo, type GitRunner, scanRepos, spawnGit } from "./project-find.ts";
export { addAllowedRoot, warnIfNoRoots } from "./roots.ts";
