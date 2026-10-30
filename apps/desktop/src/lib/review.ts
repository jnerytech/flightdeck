import type { DiffFile, ReviewComment } from "@flightdeck/protocol";

/** One row of a file's diff: a hunk header or a line with its numbers on each side. */
export type DiffRow =
  | { kind: "hunk"; header: string }
  | {
      kind: "line";
      op: "+" | "-" | " ";
      text: string;
      /** Line number in the previous version (`null` for an added line). */
      oldLine: number | null;
      /** Line number in the file as it is now (`null` for a removed line). */
      newLine: number | null;
    };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The rows of a file's diff, numbered from each hunk's `@@ -a,b +c,d @@` header. */
export function diffRows(file: DiffFile): DiffRow[] {
  return file.hunks.flatMap((hunk) => {
    const match = HUNK.exec(hunk.header);
    let oldLine = Number(match?.[1] ?? 1);
    let newLine = Number(match?.[2] ?? 1);
    const rows: DiffRow[] = [{ kind: "hunk", header: hunk.header }];
    for (const line of hunk.lines) {
      if (line.op === "-") rows.push({ kind: "line", ...line, oldLine: oldLine++, newLine: null });
      else if (line.op === "+") {
        rows.push({ kind: "line", ...line, oldLine: null, newLine: newLine++ });
      } else rows.push({ kind: "line", ...line, oldLine: oldLine++, newLine: newLine++ });
    }
    return rows;
  });
}

/** A line or a range picked in the diff to comment on. */
export interface Selection {
  path: string;
  /** `old`: the previous version (removed lines); `new`: the file as it is now. */
  side: ReviewComment["side"];
  start: number;
  end: number;
}

/** The selection after a click: a plain click starts one, a shift click extends it on its side. */
export function select(
  current: Selection | null,
  path: string,
  side: ReviewComment["side"],
  line: number,
  extend: boolean,
): Selection {
  if (extend && current && current.path === path && current.side === side) {
    return {
      path,
      side,
      start: Math.min(current.start, line),
      end: Math.max(current.end, line),
    };
  }
  return { path, side, start: line, end: line };
}

/** Whether a line of the diff lies inside the selection. */
export function selected(
  selection: Selection | null,
  path: string,
  side: ReviewComment["side"],
  line: number,
): boolean {
  return (
    selection !== null &&
    selection.path === path &&
    selection.side === side &&
    line >= selection.start &&
    line <= selection.end
  );
}
