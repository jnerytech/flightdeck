import { runsCliVerb } from "./shell-call.ts";

/**
 * `worktree remove` deletes the folder of a worktree and the branch it was on (#3702). The daemon refuses a folder with
 * uncommitted work, commits nowhere else, a live session or another branch than a card's, but the app asks the person
 * first; from a shell, `--confirm` is only a typed word, so a session could clean up the folders of other sessions.
 * `list` only reads, so it stays ordinary.
 */
const removesWorktrees = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "worktree", ["remove"]);

/** The `worktree` verbs that are high from a shell, each with what it is stopped for. */
export const WORKTREE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: removesWorktrees,
    reason: () =>
      "deletes the folder of a worktree and the branch it was on, work the person did not look at again in the app; a typed --confirm is not the person (flightdeckd worktree remove)",
  },
];
