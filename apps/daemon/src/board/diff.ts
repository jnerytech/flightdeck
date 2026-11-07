import { join } from "node:path";
import { inSequence } from "@flightdeck/protocol";
import { maskConfig, maskedConfig } from "../permissions/mask-config.ts";
import { credential } from "../permissions/sensitive-paths.ts";
import { readRegularSized } from "../read-regular.ts";
import { git, gitLimited } from "./command.ts";
import { type Rev, refArg } from "./ref-arg.ts";
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

/** A file git does not track yet, before its content is known. */
const newFile = (path: string, binary: boolean): DiffFile => ({
  path,
  oldPath: null,
  status: "added",
  additions: 0,
  deletions: 0,
  uncommitted: true,
  binary,
  hunks: [],
});

/** A file that may hold a credential (issues #449, #509): listed with its mark, no lines, no counts. */
const secretFile = (file: DiffFile): DiffFile => ({
  ...file,
  secret: true,
  additions: 0,
  deletions: 0,
  hunks: [],
});

/** A credential file that is shown anyway, its private values masked (#806): `.mcp.json`. */
const unlisted = (path: string) => credential(path) && !maskedConfig(path);

const masks = (text: string) => text.split('"[redacted]"').length;

/**
 * A config's hunks with their private values masked; the command it runs stays readable. The old
 * side (context and removed lines) and the new side (context and added lines) are masked as two
 * texts, each as a hunk may open anywhere in it; a context line keeps the stricter of its two.
 */
const maskedFile = (file: DiffFile): DiffFile => ({
  ...file,
  hunks: file.hunks.map((hunk) => {
    const old = maskConfig(
      hunk.lines.filter((line) => line.op !== "+").map((line) => line.text),
      true,
    );
    const now = maskConfig(
      hunk.lines.filter((line) => line.op !== "-").map((line) => line.text),
      true,
    );
    let o = 0;
    let n = 0;
    return {
      ...hunk,
      header: maskConfig([hunk.header], true)[0] ?? hunk.header,
      lines: hunk.lines.map((line) => {
        const before = line.op === "+" ? "" : (old[o++] ?? "");
        const after = line.op === "-" ? "" : (now[n++] ?? "");
        const text =
          line.op === "+" || (line.op === " " && masks(after) > masks(before)) ? after : before;
        return { ...line, text };
      }),
    };
  }),
});

/**
 * The files of a diff, with the content of every credential file, old path or new, left out; a
 * config shown masked keeps its lines, masked.
 */
const withoutSecrets = (files: DiffFile[]) =>
  files.map((file) => {
    if (unlisted(file.path) || (file.oldPath !== null && unlisted(file.oldPath))) {
      return secretFile(file);
    }
    const shown = maskedConfig(file.path) || (file.oldPath !== null && maskedConfig(file.oldPath));
    return shown ? maskedFile(file) : file;
  });

/**
 * A file git does not track yet, shown as entirely added. A link or a pipe is listed without
 * content, like a binary file: a link is never followed. A file over `max` bytes is listed with the
 * `tooLarge` marker and its size, and is never read past `max` (issue #329).
 */
async function untrackedFile(worktree: string, path: string, max: number): Promise<DiffFile> {
  if (unlisted(path)) return secretFile(newFile(path, false));
  const read = await readRegularSized(join(worktree, path), max + 1);
  const content = read?.data ?? null;
  const file = newFile(path, !content);
  if (!content) return file;
  if (content.length > max) {
    return { ...file, tooLarge: true, bytes: read?.size ?? content.length };
  }
  if (content.includes(0)) return { ...file, binary: true };
  const lines = content.toString("utf8").replace(/\n$/, "").split("\n");
  const added = {
    ...file,
    additions: lines.length,
    hunks: [
      {
        header: `@@ -0,0 +1,${lines.length} @@`,
        lines: lines.map((text) => ({ op: "+" as const, text })),
      },
    ],
  };
  return maskedConfig(path) ? maskedFile(added) : added;
}

/**
 * The most a file may weigh for the Changes panel to show it (issue #329): a new file over it, or a
 * diff over it, is listed with the `tooLarge` marker and its size, and without content.
 */
export const DIFF_FILE_MAX = 512 * 1024;

/** What the whole answer may weigh, and how much of `git diff`'s output is read at all (issue #329). */
export interface DiffLimits {
  /** The diff text of every file shown, together: the files after it is spent are listed only. */
  totalBytes: number;
  /** `git diff` is killed after this much output: a 200 MB change must not be held in memory. */
  rawBytes: number;
}
export const DIFF_LIMITS: DiffLimits = { totalBytes: 4 * 1024 * 1024, rawBytes: 16 * 1024 * 1024 };

/** Git's empty tree: what a repository without commits is compared with. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** The size of a file's diff text: each line with its marker and its newline, in bytes. */
function diffBytes(file: DiffFile): number {
  let bytes = 0;
  for (const hunk of file.hunks)
    for (const line of hunk.lines) bytes += Buffer.byteLength(line.text) + 2;
  return bytes;
}

/**
 * A file whose diff is over `max` bytes, or that would spend more than what is left of the budget,
 * is kept with its counts, without hunks, marked `tooLarge`.
 */
function budgeted(
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
function parseNameStatus(text: string, uncommitted: boolean): DiffFile[] {
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
function parseNumstat(
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

/**
 * The tracked change of `against` (a `git diff` argument), as files. When `git diff` writes more
 * than `rawBytes`, it is stopped, the file it was in the middle of is dropped, and every file that
 * was not read whole is listed from `--name-status` and `--numstat`, which stay small.
 */
async function trackedFiles(
  cwd: string,
  against: string,
  uncommitted: boolean,
  rawBytes: number,
): Promise<DiffFile[]> {
  const out = await gitLimited(cwd, rawBytes, ...DIFF, "--end-of-options", against);
  if (!out.truncated) return parseUnifiedDiff(must(out, "git diff").stdout, uncommitted);
  const read = parseUnifiedDiff(out.stdout, uncommitted).slice(0, -1);
  const names = must(
    await git(cwd, ...RAW_PATHS, "diff", "--name-status", "-z", "-M", "--end-of-options", against),
    "git diff",
  );
  const counts = parseNumstat(
    must(
      await git(cwd, ...RAW_PATHS, "diff", "--numstat", "-z", "-M", "--end-of-options", against),
      "git diff",
    ).stdout,
  );
  const whole = new Set(read.map((file) => file.path));
  const listed = parseNameStatus(names.stdout, uncommitted)
    .filter((file) => !whole.has(file.path))
    .map((file) => {
      const count = counts.get(file.path);
      return {
        ...file,
        additions: count?.additions ?? 0,
        deletions: count?.deletions ?? 0,
        binary: count?.binary ?? false,
        ...(count?.binary ? {} : { tooLarge: true }),
      };
    });
  return [...read, ...listed];
}

/**
 * Uncommitted tracked changes against `HEAD` (the empty tree before the first commit), then
 * untracked files. A new file over `maxUntracked` bytes and a diff over `maxTracked` bytes are
 * listed without content, and so is whatever comes after `limits.totalBytes` of diff (issue #329).
 */
export async function workingDiff(
  root: string,
  maxUntracked = DIFF_FILE_MAX,
  maxTracked = DIFF_FILE_MAX,
  limits: DiffLimits = DIFF_LIMITS,
): Promise<DiffFile[]> {
  const head = await git(root, "rev-parse", "--verify", "--quiet", "HEAD");
  const against = head.code === 0 ? "HEAD" : EMPTY_TREE;
  const others = must(
    await git(root, ...RAW_PATHS, "ls-files", "--others", "--exclude-standard", "-z"),
    "git ls-files",
  );
  const untracked = others.stdout.split("\0").filter(Boolean);
  const tracked = budgeted(
    withoutSecrets(await trackedFiles(root, against, true, limits.rawBytes)),
    maxTracked,
    limits.totalBytes,
  );
  const files = tracked.files;
  let left = limits.totalBytes - tracked.used;
  // One at a time: a tree of untracked files must not open them all at once, and none is read
  // past what is left of the budget.
  await inSequence(untracked, async (path) => {
    const file = await untrackedFile(root, path, Math.min(maxUntracked, Math.max(left, 0)));
    left -= diffBytes(file);
    files.push(file);
  });
  return files;
}

/**
 * What the card changed: commits since the base (`<base>...HEAD`, so later moves of the base
 * stay out), then uncommitted tracked changes, then untracked files.
 */
export async function cardDiff(
  worktree: string,
  base: Rev,
  maxUntracked?: number,
  maxTracked = DIFF_FILE_MAX,
  limits: DiffLimits = DIFF_LIMITS,
): Promise<CardDiff> {
  const committed = budgeted(
    withoutSecrets(await trackedFiles(worktree, `${refArg(base)}...HEAD`, false, limits.rawBytes)),
    maxTracked,
    limits.totalBytes,
  );
  const working = await workingDiff(worktree, maxUntracked, maxTracked, {
    ...limits,
    totalBytes: limits.totalBytes - committed.used,
  });
  return { base, files: [...committed.files, ...working] };
}
