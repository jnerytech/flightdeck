import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./command.ts";
import type { CardDiff, DiffFile, DiffHunk } from "./types.ts";
import { must } from "./worktree.ts";

/** Paths as written, not octal-escaped. */
const RAW_PATHS = ["-c", "core.quotePath=false"];
const DIFF = [...RAW_PATHS, "diff", "--no-color", "--no-ext-diff", "-M"];

/** Splits `git diff` output into files with their hunks and line counts. */
export function parseUnifiedDiff(text: string, uncommitted: boolean): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (header) {
      file = {
        path: header[2] ?? "",
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

function addLine(file: DiffFile, hunk: DiffHunk, line: string): void {
  const op = line[0];
  if (op === "+") file.additions++;
  if (op === "-") file.deletions++;
  if (op === "+" || op === "-" || op === " ") hunk.lines.push({ op, text: line.slice(1) });
}

function readHeader(file: DiffFile, line: string): void {
  if (line.startsWith("new file mode")) file.status = "added";
  if (line.startsWith("deleted file mode")) file.status = "deleted";
  if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
  if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
  if (line.startsWith("rename ")) file.status = "renamed";
  if (line.startsWith("Binary files ")) file.binary = true;
}

/** A file git does not track yet, shown as entirely added. */
function untrackedFile(worktree: string, path: string): DiffFile {
  const content = readFileSync(join(worktree, path));
  const binary = content.includes(0);
  const lines = binary ? [] : content.toString("utf8").replace(/\n$/, "").split("\n");
  const hunks = binary
    ? []
    : [
        {
          header: `@@ -0,0 +1,${lines.length} @@`,
          lines: lines.map((text) => ({ op: "+" as const, text })),
        },
      ];
  return {
    path,
    oldPath: null,
    status: "added",
    additions: lines.length,
    deletions: 0,
    uncommitted: true,
    binary,
    hunks,
  };
}

/**
 * What the card changed: commits since the base (`<base>...HEAD`, so later moves of the base
 * stay out), then uncommitted tracked changes, then untracked files.
 */
export async function cardDiff(worktree: string, base: string): Promise<CardDiff> {
  const committed = must(await git(worktree, ...DIFF, `${base}...HEAD`), "git diff");
  const pending = must(await git(worktree, ...DIFF, "HEAD"), "git diff");
  const others = must(
    await git(worktree, ...RAW_PATHS, "ls-files", "--others", "--exclude-standard", "-z"),
    "git ls-files",
  );
  const untracked = others.stdout.split("\0").filter(Boolean);
  return {
    base,
    files: [
      ...parseUnifiedDiff(committed.stdout, false),
      ...parseUnifiedDiff(pending.stdout, true),
      ...untracked.map((path) => untrackedFile(worktree, path)),
    ],
  };
}
