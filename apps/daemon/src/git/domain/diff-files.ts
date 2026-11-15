import type { DiffFile } from "@flightdeck/protocol";

/** The size of a file's diff text: each line with its marker and its newline, in bytes. */
export function diffBytes(file: DiffFile): number {
  let bytes = 0;
  for (const hunk of file.hunks)
    for (const line of hunk.lines) bytes += Buffer.byteLength(line.text) + 2;
  return bytes;
}

/**
 * A file whose diff is over `max` bytes, or that would spend more than what is left of the budget,
 * is kept with its counts, without hunks, marked `tooLarge`.
 */
export function budgeted(
  files: DiffFile[],
  max: number,
  budget: number,
): { files: DiffFile[]; used: number } {
  let used = 0;
  const kept = files.map((file) => {
    const bytes = diffBytes(file);
    if (bytes > max || used + bytes > budget) return { ...file, hunks: [], tooLarge: true, bytes };
    used += bytes;
    return file;
  });
  return { files: kept, used };
}

/** `git diff --name-status -z` of the files of a change, as listed files without content. */
export function parseNameStatus(text: string, uncommitted: boolean): DiffFile[] {
  const parts = text.split("\0");
  const listed: DiffFile[] = [];
  for (let i = 0; i < parts.length && parts[i]; ) {
    const kind = (parts[i++] as string)[0];
    const renamed = kind === "R" || kind === "C";
    const oldPath = renamed ? (parts[i++] as string) : null;
    const status = renamed
      ? "renamed"
      : (({ A: "added", D: "deleted" } as Record<string, DiffFile["status"]>)[kind as string] ??
        "modified");
    listed.push({
      path: parts[i++] as string,
      oldPath,
      status,
      additions: 0,
      deletions: 0,
      uncommitted,
      binary: false,
      hunks: [],
    });
  }
  return listed;
}

/** `git diff --numstat -z`: the counts of each file, by its new path (`-` for a binary file). */
export function parseNumstat(
  text: string,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const parts = text.split("\0");
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (let i = 0; i < parts.length && parts[i]; ) {
    const [added = "", removed = "", path = ""] = (parts[i++] as string).split("\t");
    // A rename is `adds<TAB>dels<TAB>` then the old and the new path as the next two records.
    let name = path;
    if (path === "") {
      i++;
      name = parts[i++] as string;
    }
    const binary = added === "-";
    counts.set(name, {
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(removed),
      binary,
    });
  }
  return counts;
}
