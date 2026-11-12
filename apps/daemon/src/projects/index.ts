/**
 * The projects domain's public entry (#1594): finding a host's projects, the git repositories
 * under its allowed roots, and cloning one into a root. Another domain imports from here, never a
 * file inside.
 */
export { allowedRoot, cloneRepo, type GitRunner, scanRepos, spawnGit } from "./project-find.ts";
