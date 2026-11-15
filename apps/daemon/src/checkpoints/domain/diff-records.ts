/**
 * Reads the two `git diff -z` outputs: `--name-status` (`status NUL path NUL`) and `--numstat`
 * (`added TAB removed TAB path NUL`). With `-z` git prints a path as it is, never quoted, so a
 * name with an accent, a quote, a tab or a newline reads back whole.
 */
import { CHANGES, type TurnFiles } from "./snapshot-hook.ts";

export function filesOf(nameStatus: string): TurnFiles["files"] {
  const fields = nameStatus.split("\0");
  const files: TurnFiles["files"] = [];
  // A final NUL leaves one empty field at the end.
  for (let at = 0; at + 1 < fields.length; at += 2) {
    files.push({
      path: fields[at + 1] as string,
      change: CHANGES[fields[at] as string] ?? "modified",
    });
  }
  return files;
}

/** The lines added and removed, as the second tells; a binary file (`-` counts) adds none. */
export function linesOf(numstat: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const record of numstat.split("\0")) {
    const [plus, minus] = record.split("\t");
    added += Number(plus) || 0;
    removed += Number(minus) || 0;
  }
  return { added, removed };
}
