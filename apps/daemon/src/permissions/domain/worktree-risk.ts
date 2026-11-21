import { runsCliVerb } from "./shell-call.ts";

/**
 * `worktree remove` deletes the folder of a worktree and the branch it was on (#3702). The daemon refuses a folder with
 * uncommitted work, commits nowhere else, a live session or another branch than a card's, but the app asks the person
 * first; from a shell, `--confirm` is only a typed word, so a session could clean up the folders of other sessions.
 * `list` only reads, so it stays ordinary. `card pr-comments-send` puts PR comments, outside authors' included, into a
 * session as a message, as `review send` does, so a session cannot do it unprompted either.
 */
const removesWorktrees = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "worktree", ["remove"]);

const sendsPrComments = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "card", ["pr-comments-send"]);

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
  {
    when: sendsPrComments,
    reason: () =>
      "puts chosen pull request comments, some of them from outside the team, into a card's session as a message, which the app sends only when the person picks the comments (flightdeckd card pr-comments-send)",
  },
];
