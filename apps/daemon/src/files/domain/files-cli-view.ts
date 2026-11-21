/**
 * Issue #3624: what `flightdeckd file list|read|search|dirs|files` prints. Every name and every line of text comes
 * from the daemon, which read it from a checkout: `said` and `json` clean them for a terminal (a tab becomes a
 * space, and so does a character that could move the cursor), so `--json` is the way to get a file as the host
 * has it, up to the DEL, C1 and zero-width characters `json` also cleans. A file that may hold a credential is
 * listed by name and never read, and it stays so here.
 */
import type {
  FileListing,
  FileSearchResult,
  FsDirsResult,
  FsFilesResult,
} from "@flightdeck/protocol";

/** What the file runner takes: one verb, its target or host path, and the flags that belong to it. */
export type FileCliArgs =
  | { action: "list"; target: string; dir: string; json?: boolean }
  | { action: "read"; target: string; path: string; json?: boolean }
  | {
      action: "search";
      target: string;
      mode: "name" | "content";
      query: string;
      limit?: number;
      json?: boolean;
    }
  | {
      action: "write";
      target: string;
      path: string;
      /** The new text's file, or `-` for standard input. */
      file: string;
      /** The hash `read` printed: the version this write replaces. */
      expectedHash: string;
      confirm: true;
      json?: boolean;
    }
  | { action: "dirs"; path?: string; hidden?: boolean; json?: boolean }
  | { action: "files"; path: string; hidden?: boolean; json?: boolean };

export interface FileRead {
  path: string;
  text: string;
  hash: string;
  size: number;
}

const MORE = "more entries than the daemon sends at once";

/** A folder as the protocol returns it, `secret` kept on every entry. */
export const listJson = (listing: FileListing) => ({
  dir: listing.dir,
  entries: listing.entries.map((entry) => ({ ...entry, secret: entry.secret ?? false })),
  truncated: listing.truncated,
});

/** The folder, then one line for each entry: a folder with a `/`, a credential file marked. */
export function listLines(target: string, listing: FileListing): string[] {
  const entries = listing.entries.map((entry) => {
    if (entry.kind === "dir") return `  dir  ${entry.name}/`;
    return `  file ${entry.name}${entry.secret ? " (may hold a credential, not read)" : ""}`;
  });
  return [
    `${target} ${listing.dir || "."}`,
    ...(entries.length === 0 ? ["empty folder"] : entries),
    ...(listing.truncated ? [MORE] : []),
  ];
}

export const readJson = (file: FileRead) => ({
  path: file.path,
  text: file.text,
  hash: file.hash,
  size: file.size,
});

/** The file's size and hash on a line of their own, then its text line by line (the last line break ends a line, it does not add one). */
export function readLines(file: FileRead): string[] {
  const lines = file.text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return [`${file.path} (${file.size} bytes, hash ${file.hash})`, ...lines];
}

export const searchJson = (result: FileSearchResult) => ({
  mode: result.mode,
  query: result.query,
  matches: result.matches.map((match) => ({
    path: match.path,
    secret: match.secret ?? false,
    line: match.line ?? null,
    text: match.text ?? null,
  })),
  truncated: result.truncated,
});

/** What the search was, where, and one line for each match; a credential file by name only. */
export function searchLines(target: string, result: FileSearchResult): string[] {
  const { matches } = result;
  const count =
    matches.length === 0
      ? "no matches"
      : `${matches.length} match${matches.length === 1 ? "" : "es"}`;
  const found = matches.map((match) => {
    if (match.secret) return `  ${match.path} (may hold a credential, content not searched)`;
    return match.line === undefined
      ? `  ${match.path}`
      : `  ${match.path}:${match.line}: ${match.text ?? ""}`;
  });
  return [
    `${result.mode} "${result.query}" in ${target}: ${count}`,
    ...found,
    ...(result.truncated ? ["more matches than shown: narrow the query or raise --limit"] : []),
  ];
}

export const dirsJson = (listing: FsDirsResult) => ({
  path: listing.path,
  parent: listing.parent,
  dirs: listing.dirs,
  truncated: listing.truncated,
});

/** The folder and the one above it, then each subfolder's path; no folder is the roots the host allows. */
export function dirsLines(listing: FsDirsResult): string[] {
  return [
    listing.path ?? "allowed roots",
    ...(listing.parent === null ? [] : [`parent: ${listing.parent}`]),
    ...(listing.dirs.length === 0 ? ["no folders"] : listing.dirs.map((dir) => `  ${dir.path}`)),
    ...(listing.truncated ? ["more folders than the daemon sends at once"] : []),
  ];
}

export const filesJson = (listing: FsFilesResult) => ({
  path: listing.path,
  files: listing.files,
  truncated: listing.truncated,
});

export function filesLines(listing: FsFilesResult): string[] {
  return [
    listing.path,
    ...(listing.files.length === 0 ? ["no files"] : listing.files.map((file) => `  ${file.path}`)),
    ...(listing.truncated ? ["more files than the daemon sends at once"] : []),
  ];
}
