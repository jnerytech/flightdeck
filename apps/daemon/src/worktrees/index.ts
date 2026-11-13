/**
 * The worktrees domain's public entry (#1589): the git worktrees the board creates and removes for
 * its cards, and the error a folder being removed gives to whoever tries to open it. `main.ts` still
 * builds the domain through `locks.ts` and `wiring.ts`. Another domain imports from here, never a file
 * inside.
 */
export { folderRemoving } from "./locks.ts";
export type { Worktrees } from "./worktrees.ts";
