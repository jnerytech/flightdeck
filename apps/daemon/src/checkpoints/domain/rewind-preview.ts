/**
 * What going back to a snapshot would change, read from the two `git diff` outputs between the
 * target's tree and the working tree now: the files with a word for each change, and the lines
 * seen from the target's point of view.
 */
import { CHANGES, type TurnFiles } from "./snapshot-hook.ts";

/** `nameStatus` is the output of `git diff --name-status --no-renames`, `numstat` of `--numstat`, both trimmed. */
export function previewOf(nameStatus: string, numstat: string): TurnFiles {
  const files = nameStatus
    ? nameStatus.split("\n").map((line) => {
        const [status, path] = line.split("\t") as [string, string];
        // From the target's point of view: created after it, deleted after it, or changed.
        return { path, change: CHANGES[status] ?? "modified" };
      })
    : [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat ? numstat.split("\n") : []) {
    const [added, removed] = line.split("\t");
    // Going back removes what was added after the target, and puts back what was removed.
    deletions += Number(added) || 0;
    insertions += Number(removed) || 0;
  }
  return { files, insertions, deletions };
}
