// The Review context: the changes of a session or card (diff, files, revert, commit, PR), review comments and the file browser (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";

export const DiffLine = z.object({ op: z.enum(["+", "-", " "]), text: z.string() });
export type DiffLine = z.infer<typeof DiffLine>;

export const DiffHunk = z.object({
  /** The `@@ -a,b +c,d @@` line. */
  header: z.string(),
  lines: z.array(DiffLine),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const DiffFile = z.object({
  path: z.string(),
  /** Previous path of a renamed file. */
  oldPath: z.string().nullable(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** Not committed yet (tracked change or new file). */
  uncommitted: z.boolean(),
  binary: z.boolean(),
  /**
   * The file is listed without content because it is over the daemon's cap (issue #329): a new file
   * over it, or a diff over it. Absent from a daemon that does not know the marker.
   */
  tooLarge: z.boolean().optional(),
  /** With `tooLarge`: the size of the file (a new one) or of its diff text, in bytes. */
  bytes: z.number().int().nonnegative().optional(),
  /**
   * The file may hold a credential (the daemon's list, issue #449): it is listed with no lines and
   * no counts, and the daemon never reads a new one (issue #509). Absent from an older daemon.
   */
  secret: z.boolean().optional(),
  /**
   * #1133: a session's uncommitted file as it is now (sha256 of its bytes, `deleted` when it is
   * gone): `changes.commit` takes back the digests the person saw, and refuses when one moved.
   */
  digest: z.string().optional(),
  hunks: z.array(DiffHunk),
});
export type DiffFile = z.infer<typeof DiffFile>;

/** One entry of a folder in the file explorer (issue #506). */
export interface FileEntry {
  name: string;
  /** What it is, links followed: a link is listed only when it stays in the repository. */
  kind: "dir" | "file";
  /** It may hold a credential (issue #449): shown as hidden, never opened (issue #509). */
  secret?: boolean;
}

/** A folder of the repository, folders first, then files, in natural order. */
export interface FileListing {
  /** The folder, relative to the repository's root ("" for the root). */
  dir: string;
  entries: FileEntry[];
  /** More entries than the host sends at once. */
  truncated: boolean;
}

/** Issue #1439: a finding of a second-opinion review. */
export const ReviewFinding = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  severity: z.enum(["blocker", "high", "medium", "low"]),
  body: z.string(),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

// Phase 11: review of the changes of any session or card.
/**
 * `session:<claudeSessionId>`, `card:<id>`, `terminal:<terminalId>` (its folder, #506) or
 * `project:<projectId>` (its own checkout, read only, #797).
 */
export const ReviewTarget = z
  .string()
  .regex(
    /^(session|card|terminal|project):.+$/,
    "target session:<id>, card:<id>, terminal:<id> or project:<id>",
  );

/** Issue #797: a search over a repository, by path or by content; a fixed string, never a pattern. */
export const FileSearchPayload = z
  .object({
    target: ReviewTarget,
    mode: z.enum(["name", "content"]),
    // A program gets it as one argument: no control character (a NUL, a line break) splits it.
    query: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\p{Cc}]+$/u, "no control characters"),
    /** At most this many matches; 100 when absent. */
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type FileSearchPayload = z.infer<typeof FileSearchPayload>;

export interface FileSearchMatch {
  /** Relative to the target's repository, with `/`. */
  path: string;
  /** A credential file: its name matched, its content is never searched. */
  secret?: true;
  /** Content search: the line's number (from 1) and its text, cut to 200 characters. */
  line?: number;
  text?: string;
}

export interface FileSearchResult {
  mode: "name" | "content";
  query: string;
  matches: FileSearchMatch[];
  /** More matches than the limit, more output than the cap, or out of time. */
  truncated: boolean;
}

export const ChangesResult = z.object({
  target: z.string(),
  /** The repository's top level (the card's worktree). */
  root: z.string(),
  /** The card's base branch; `null` for a session, whose diff is against `HEAD`. */
  base: z.string().nullable(),
  files: z.array(DiffFile),
  /** A card's commits ahead of and behind its base; `null` for a session. */
  position: z.object({ ahead: z.number().int(), behind: z.number().int() }).nullable(),
  /**
   * #1133: the commit hooks a commit of this checkout runs (`pre-commit`, `commit-msg`...), shown
   * before the person confirms one. Only for a target against `HEAD`.
   */
  hooks: z.array(z.string()).optional(),
  /**
   * #1133: where a PR's push would go (`origin`'s push address, no password in it); the person's
   * confirm sends it back, and a push address changed since refuses. Only against `HEAD`.
   */
  remote: z.string().optional(),
});
export type ChangesResult = z.infer<typeof ChangesResult>;

/** #1133: what `changes.commit` made: the new branch, the one it started from, and the commit. */
export const ChangesCommitted = z.object({
  branch: z.string(),
  /** The branch the checkout was on; null when it was detached. */
  base: z.string().nullable(),
  commit: z.string(),
  files: z.array(z.string()),
});
export type ChangesCommitted = z.infer<typeof ChangesCommitted>;

/** #1133, slice D2: the PR `changes.pr` opened, and the branches it joins. */
export const ChangesPrOpened = z.object({ url: z.string(), branch: z.string(), base: z.string() });
export type ChangesPrOpened = z.infer<typeof ChangesPrOpened>;

const ReviewSide = z.enum(["new", "old"]);

export const FileSession = z.object({
  claudeSessionId: z.string(),
  edits: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
  title: z.string().nullable(),
});
export type FileSession = z.infer<typeof FileSession>;

/** An inline comment on a target's diff: a draft until the review goes to the agent. */
export const ReviewComment = z.object({
  id: z.string(),
  target: z.string(),
  path: z.string(),
  /** `new`: the file as it is now; `old`: the version it is compared with (HEAD or the base). */
  side: ReviewSide,
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  /** The quoted lines, read by the daemon; the comment follows them when the file changes. */
  quote: z.string(),
  body: z.string(),
  state: z.enum(["draft", "sent"]),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  /** The quoted lines are no longer in the file. */
  outdated: z.boolean(),
  /** Issue #1439: a second opinion's finding, until the person edits it. */
  author: z.literal("reviewer").optional(),
  severity: z.enum(["blocker", "high", "medium", "low"]).optional(),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

export const ReviewSent = z.object({
  /** `copy`: the session takes no messages, the app hands `text` over. */
  via: z.enum(["session", "card", "terminal", "copy"]),
  text: z.string(),
  comments: z.number().int(),
});
export type ReviewSent = z.infer<typeof ReviewSent>;

/** Sent after `changes.watch`: the target's diff after a change on disk. */
export const ChangesUpdated = z.object({
  type: z.literal("changes.updated"),
  ...ChangesResult.shape,
});
export type ChangesUpdated = z.infer<typeof ChangesUpdated>;

/** The review commands; index.ts spreads them into `Command`. */
export const reviewCommands = [
  cmd("changes.get", z.object({ target: ReviewTarget })),
  /** The sessions that wrote a file, by its absolute path. */
  cmd("files.sessions", z.object({ path: z.string().min(1) })),
  /** `changes.updated` after each change on disk (500 ms debounce), until `changes.unwatch`. */
  cmd("changes.watch", z.object({ target: ReviewTarget })),
  cmd("changes.unwatch", z.object({ target: ReviewTarget })),
  cmd("review.list", z.object({ target: ReviewTarget })),
  cmd(
    "review.add",
    z.object({
      target: ReviewTarget,
      path: z.string().min(1),
      side: ReviewSide,
      lineStart: z.number().int().min(1),
      lineEnd: z.number().int().min(1),
      body: z.string().min(1),
    }),
  ),
  cmd("review.update", z.object({ id: z.string(), body: z.string().min(1) })),
  cmd("review.remove", z.object({ id: z.string() })),
  cmd(
    "review.send",
    z.object({
      target: ReviewTarget,
      /** The language the review is written in (the app's); English when absent. */
      language: z.enum(["en", "pt-BR"]).optional(),
    }),
  ),
  cmd(
    "changes.revert",
    z.object({ target: ReviewTarget, path: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  /**
   * #1133: commits the chosen uncommitted files of a plain session on a new branch, in the person's
   * own checkout with their hooks. `files` maps each path to the digest `changes.get` gave.
   */
  cmd(
    "changes.commit",
    z
      .object({
        target: ReviewTarget,
        files: z
          .record(z.string().min(1).max(4096), z.string().max(128))
          .refine((files) => Object.keys(files).length >= 1 && Object.keys(files).length <= 500),
        message: z.string().min(1).max(20_000),
        branch: z.string().min(1).max(200),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  /**
   * #1133, slice D2: pushes the plain session's current branch to `origin` and opens its PR with the
   * title and description the person confirmed; the base is the branch `changes.commit` started from.
   */
  cmd(
    "changes.pr",
    z
      .object({
        target: ReviewTarget,
        title: z.string().min(1).max(256),
        body: z.string().max(65_536),
        /** The push address the person saw (`changes.get`'s `remote`). */
        remote: z.string().min(1).max(4096),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd(
    "changes.undoRevert",
    z.object({ target: ReviewTarget, path: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  cmd("file.read", z.object({ target: ReviewTarget, path: z.string().min(1) })),
  /** Issue #506: one folder of the target's repository for the file explorer; `dir` is "" for its root. */
  cmd("file.list", z.object({ target: ReviewTarget, dir: z.string() })),
  /** Issue #797: a search over the target's repository, by name or by content. */
  cmd("file.search", FileSearchPayload),
  /** Written only if the file still has `expectedHash`; otherwise `file_conflict`. */
  cmd(
    "file.write",
    z.object({
      target: ReviewTarget,
      path: z.string().min(1),
      text: z.string(),
      expectedHash: z.string(),
    }),
  ),
] as const;

/** The `data` of each review command's ack; `CommandResults` extends it. */
export interface ReviewResults {
  "changes.get": ChangesResult;
  "files.sessions": { sessions: FileSession[] };
  "changes.watch": undefined;
  "changes.unwatch": undefined;
  "review.list": { comments: ReviewComment[] };
  "review.add": ReviewComment;
  "review.update": ReviewComment | null;
  "review.remove": undefined;
  "review.send": ReviewSent;
  /** Undo with `changes.undoRevert` until `undoUntil`. */
  "changes.revert": { path: string; undoUntil: string };
  "changes.commit": ChangesCommitted;
  "changes.pr": ChangesPrOpened;
  "changes.undoRevert": { path: string };
  /** `hash`: sha256 of the bytes, hex, for `file.write`. */
  "file.read": { path: string; text: string; hash: string; size: number };
  "file.list": FileListing;
  "file.search": FileSearchResult;
  "file.write": { path: string; hash: string; size: number };
}
