import type { DiffFile, DiffHunk } from "@flightdeck/protocol";

/** Splits `git diff` output into files with their hunks and line counts. */
export function parseUnifiedDiff(text: string, uncommitted: boolean): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = {
        path: headerPath(line.slice("diff --git ".length)),
        oldPath: null,
        status: "modified",
        additions: 0,
        deletions: 0,
        uncommitted,
        binary: false,
        hunks: [],
      };
      files.push(file);
      hunk = undefined;
    } else if (file && line.startsWith("@@")) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (file && hunk) {
      addLine(file, hunk, line);
    } else if (file) {
      readHeader(file, line);
    }
  }
  return files;
}

/** What git writes for each escaped character of a quoted name. */
const ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * A name as git wrote it: in double quotes, with C escapes, when it has a quote, a backslash or a
 * control character in it (even with `core.quotePath=false`); as it is otherwise.
 */
function unquoted(name: string): string {
  if (!name.startsWith('"') || !name.endsWith('"')) return name;
  return name
    .slice(1, -1)
    .replace(/\\([0-7]{3}|.)/g, (_, escaped: string) =>
      escaped.length === 3
        ? String.fromCodePoint(Number.parseInt(escaped, 8))
        : (ESCAPES[escaped] ?? escaped),
    );
}

/**
 * The new name in a `diff --git a/<old> b/<new>` line. A quoted new name starts at the last
 * ` "b/`, which cannot occur inside a quoted name (its quotes are escaped); an unquoted one after
 * the last ` b/`, as before.
 */
function headerPath(names: string): string {
  if (names.endsWith('"')) {
    const start = names.lastIndexOf(' "b/');
    return unquoted(`"${names.slice(start + ' "b/'.length)}`);
  }
  const plain = /^(?:a\/.*|".*") b\/(.*)$/.exec(names);
  return plain?.[1] ?? "";
}

function addLine(file: DiffFile, hunk: DiffHunk, line: string): void {
  const op = line[0];
  if (op === "+") file.additions++;
  if (op === "-") file.deletions++;
  if (op === "+" || op === "-" || op === " ") hunk.lines.push({ op, text: line.slice(1) });
}

function readHeader(file: DiffFile, line: string): void {
  if (line.startsWith("new file mode")) file.status = "added";
  if (line.startsWith("deleted file mode")) file.status = "deleted";
  if (line.startsWith("rename from ")) file.oldPath = unquoted(line.slice("rename from ".length));
  if (line.startsWith("rename to ")) file.path = unquoted(line.slice("rename to ".length));
  if (line.startsWith("rename ")) file.status = "renamed";
  if (line.startsWith("Binary files ")) file.binary = true;
}
