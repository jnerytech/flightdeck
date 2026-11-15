/**
 * What going back to a snapshot would change, read from the two `git diff -z` outputs between the
 * target's tree and the working tree now: the files with a word for each change, and the lines
 * seen from the target's point of view.
 */
import { filesOf, linesOf } from "./diff-records.ts";
import type { TurnFiles } from "./snapshot-hook.ts";

/** `nameStatus` is the output of `git diff -z --name-status --no-renames`, `numstat` of `-z --numstat`. */
export function previewOf(nameStatus: string, numstat: string): TurnFiles {
  // From the target's point of view: what was added after it goes away, what was removed comes back.
  const { added, removed } = linesOf(numstat);
  return { files: filesOf(nameStatus), insertions: removed, deletions: added };
}
