/**
 * What going back to a snapshot would change, read from the two `git diff` outputs between the
 * target's tree and the working tree now: the files with a word for each change, and the lines
 * seen from the target's point of view.
 */
import { CHANGES, type TurnFiles } from "./snapshot-hook.ts";

/**
 * `nameStatus` is the output of `git diff -z --name-status --no-renames` (`status NUL path NUL`) and
 * `numstat` of `-z --numstat` (`added TAB removed TAB path NUL`). With `-z` git prints a path as it
 * is, never quoted, so a name with an accent, a quote or a newline reads back whole.
 */
export function previewOf(nameStatus: string, numstat: string): TurnFiles {
  const fields = nameStatus.split("\0");
  const files: TurnFiles["files"] = [];
  // A final NUL leaves one empty field at the end.
  for (let at = 0; at + 1 < fields.length; at += 2) {
    // From the target's point of view: created after it, deleted after it, or changed.
    files.push({
      path: fields[at + 1] as string,
      change: CHANGES[fields[at] as string] ?? "modified",
    });
  }
  let insertions = 0;
  let deletions = 0;
  for (const record of numstat.split("\0")) {
    const [added, removed] = record.split("\t");
    // Going back removes what was added after the target, and puts back what was removed.
    deletions += Number(added) || 0;
    insertions += Number(removed) || 0;
  }
  return { files, insertions, deletions };
}
