/**
 * The worktrees domain's public entry (#1589): the git worktrees the board creates and removes for
 * its cards, the error a folder being removed gives to whoever tries to open it, and where Claude
 * Code keeps a project's local settings. `main.ts` still
 * builds the domain through `domain/locks.ts` and `wiring.ts`. Another domain imports from here, never a file
 * inside.
 */
export { LOCAL_SETTINGS } from "./domain/local-settings.ts";
export { folderRemoving } from "./domain/locks.ts";
export {
  addWorktree,
  excludeLocalSettingsAsync,
  freshBase,
  must,
  WORKTREE_INCLUDE,
  WORKTREE_INCLUDE_LIMIT,
} from "./worktree.ts";
export type { Worktrees } from "./worktrees.ts";
