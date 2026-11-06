/** A file path in a line of terminal output (#476): where it sits, as printed, and the path alone. */
export interface FoundPath {
  /** Index of its first character in the line. */
  start: number;
  /** Index just past its last character. */
  end: number;
  /** As printed, with its `:line` or `:line:col`. */
  text: string;
  /** The path alone. */
  path: string;
  /** The line printed after it (`:12`), when there is one. */
  line?: number;
  /** The column printed after the line (`:12:5`), when there is one. */
  column?: number;
}

/**
 * A segment of a path: no space, quote, angle bracket, pipe, wildcard or colon, and nothing a shell
 * would run when a copied path is pasted ($, backtick, ;, &).
 */
const SEG = String.raw`[^\s"'<>|?*:\\/$\`;&]+`;
const KINDS = [
  // C:\a\b or C:/a/b
  String.raw`[A-Za-z]:[\\/](?:${SEG}[\\/])*${SEG}`,
  // /a/b, at least one segment
  String.raw`/(?:${SEG}/)*${SEG}`,
  // ./a or ../a/b
  String.raw`\.{1,2}/(?:${SEG}/)*${SEG}`,
  // a/b.ext: a folder and a file with an extension, so "and/or" and "1/2" are not paths
  String.raw`(?:${SEG}/)+[^\s"'<>|?*:\\/.$\`;&]+\.[A-Za-z0-9]+`,
];
// Only at the start of a word, never on its opening bracket: a web address's path (after "//" or
// a host name) is not one.
const PATHS = new RegExp(
  String.raw`(?<=^|[\s(\[{"'\`=])(?![(\[{])(?:${KINDS.join("|")})(?::\d+(?::\d+)?)?`,
  "g",
);
/** What the sentence around a path adds after it: a full stop, a comma, a closing bracket. */
const TRAILING = /[.,;)\]}]+$/;
const LINE_AND_COLUMN = /(?::\d+){1,2}$/;

/** The file paths in one line of output, left to right. */
export function findPaths(line: string): FoundPath[] {
  const found: FoundPath[] = [];
  for (const match of line.matchAll(PATHS)) {
    const text = match[0].replace(TRAILING, "");
    const path = text.replace(LINE_AND_COLUMN, "");
    if (path === "") continue;
    const [line, column] = text.slice(path.length).split(":").slice(1).map(Number);
    found.push({
      start: match.index,
      end: match.index + text.length,
      text,
      path,
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    });
  }
  return found;
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\/)/;

/**
 * The full path of one printed in a terminal: an absolute one as it is, a relative one joined to
 * the terminal's folder with that folder's separator, `.` dropped and `..` walked up.
 */
export function resolvePath(cwd: string, path: string): string {
  if (ABSOLUTE.test(path)) return path;
  const sep = cwd.includes("\\") || /^[A-Za-z]:/.test(cwd) ? "\\" : "/";
  const parts = cwd.split(/[\\/]/).filter((part, index) => part !== "" || index === 0);
  for (const part of path.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(part);
  }
  return parts.length === 1 && parts[0] === "" ? sep : parts.join(sep);
}
