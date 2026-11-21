import { runsCliVerb } from "./shell-call.ts";

/**
 * A change of a checkout from a shell (#3620): `commit` makes a commit on a new branch (with the person's git
 * hooks), `pr` pushes a branch to a remote and opens a pull request, and `revert` discards the changes of a
 * file. The app has the person read the files and confirm each of them; from a shell, `--confirm` is only a
 * typed flag. `undo-revert` only puts back what a revert took out (a session can bring back its own file inside the
 * few minutes the daemon keeps it; nothing is lost, so it stays ordinary), and `get`, `sessions` and `watch` read.
 */
const changesACheckout = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "changes", ["commit", "pr", "revert"]);

/** The `changes` verbs that are high from a shell, with what they are stopped for. */
export const CHANGES_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesACheckout,
    reason: () =>
      "commits files of the checkout on a new branch (with the person's git hooks), pushes a branch to the remote and opens a pull request, or discards the changes of a file, none of which the app does without the person confirming it (flightdeckd changes commit, pr or revert)",
  },
];
