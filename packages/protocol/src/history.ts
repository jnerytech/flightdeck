// The history: the conversations Claude Code already recorded, indexed, searched and read only (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { PermissionMode } from "./permissions.ts";
import { ListExtras, type SessionCreateResult } from "./sessions.ts";

// Phase 3: transcripts indexed from ~/.claude/projects (read only).
export const HistoryOrigin = z.enum(["flightdeck", "external"]);
export type HistoryOrigin = z.infer<typeof HistoryOrigin>;

/** Pages are addressed by an opaque cursor taken from the previous answer. */
const Cursor = z.string().min(1);

export const HistoryListPayload = z.object({
  cwd: z.string().min(1).optional(),
  /** Every folder and worktree of one project, as `projectKey` names it on the Costs screen. */
  projectKey: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  origin: HistoryOrigin.optional(),
  /** Leaves out the runs nobody typed: print-mode (sdk) sessions and sessions in temp folders. */
  hideAutomated: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: Cursor.optional(),
});

export const HistoryGetPayload = z.object({
  claudeSessionId: z.string().min(1),
  cursor: Cursor.optional(),
  /** Without a cursor: the last `limit` messages instead of the first (a transcript opens on its latest). */
  tail: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

/** Issue #606: the `index`-th tool call of the message `uuid`, read from the session's own transcript. */
export const HistoryToolPayload = z.object({
  claudeSessionId: z.string().min(1),
  uuid: z.string().min(1),
  index: z.number().int().min(0).max(1000),
});

export const HistorySearchPayload = z.object({
  query: z.string().trim().min(1),
  cwd: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const HistoryResumePayload = z.object({
  claudeSessionId: z.string().min(1),
  name: z.string().min(1).optional(),
  permissionMode: PermissionMode.optional(),
  /** Required when the transcript is `maybeActive`: two writers corrupt the conversation. */
  force: z.boolean().optional(),
});

export const HistorySessionSummary = z.object({
  claudeSessionId: z.string(),
  cwd: z.string(),
  title: z.string().nullable(),
  firstTs: z.string().nullable(),
  lastTs: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  origin: HistoryOrigin,
  /** The file changed in the last 2 minutes: another process may still be writing it. */
  maybeActive: z.boolean(),
  /** A print-mode (`claude -p`, sdk) run, or one in a temp folder: nobody typed it. */
  automated: z.boolean().optional(),
  ...ListExtras,
});
export type HistorySessionSummary = z.infer<typeof HistorySessionSummary>;

export const HistoryMessage = z.object({
  uuid: z.string(),
  ts: z.string().nullable(),
  role: z.enum(["user", "assistant", "system", "summary"]).nullable(),
  kind: z.enum(["message", "summary", "system"]),
  text: z.string(),
});
export type HistoryMessage = z.infer<typeof HistoryMessage>;

export const HistoryListResult = z.object({
  sessions: z.array(HistorySessionSummary),
  nextCursor: z.string().nullable(),
  /** How many automated runs match the other filters (the ones left out, when `hideAutomated`). */
  automatedCount: z.number().int().nonnegative().optional(),
});
export type HistoryListResult = z.infer<typeof HistoryListResult>;

export const HistoryGetResult = z.object({
  session: HistorySessionSummary,
  /** The session's folder is still on the host (said only for a folder the history already shows). */
  cwdExists: z.boolean().optional(),
  messages: z.array(HistoryMessage),
  /** The cursor this page starts at (a tail page's own, so what is appended later can be read from it). */
  cursor: z.string().optional(),
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
});
export type HistoryGetResult = z.infer<typeof HistoryGetResult>;

/** A stored tool call with its whole input and its result, each cut to 64 KiB (#606). */
export const HistoryToolDetail = z.object({
  name: z.string(),
  /** The input as the call had it, or its JSON text cut to the cap. */
  input: z.unknown(),
  /** `null` while the transcript has no result (still running, or cut short). */
  result: z.object({ content: z.string(), isError: z.boolean() }).nullable(),
  truncated: z.boolean(),
});
export type HistoryToolDetail = z.infer<typeof HistoryToolDetail>;

export const HistoryToolResult = z.object({ tool: HistoryToolDetail.nullable() });
export type HistoryToolResult = z.infer<typeof HistoryToolResult>;

export const HistorySearchHit = z.object({
  claudeSessionId: z.string(),
  uuid: z.string(),
  ts: z.string().nullable(),
  cwd: z.string(),
  title: z.string().nullable(),
  role: z.string(),
  /** Excerpt with every match wrapped in `«` and `»`. */
  snippet: z.string(),
  /** `history.get` cursor whose page starts at this message. */
  cursor: z.string(),
});
export type HistorySearchHit = z.infer<typeof HistorySearchHit>;

export const HistorySearchResult = z.object({ hits: z.array(HistorySearchHit) });
export type HistorySearchResult = z.infer<typeof HistorySearchResult>;

/** Sent after `history.watch` whenever a transcript gains lines. Not a session event. */
export const HistoryChanged = z.object({
  type: z.literal("history.changed"),
  claudeSessionId: z.string(),
  cwd: z.string(),
  lastTs: z.string().nullable(),
  maybeActive: z.boolean(),
});
export type HistoryChanged = z.infer<typeof HistoryChanged>;

/** The history commands; index.ts spreads them into `Command`. */
export const historyCommands = [
  cmd("history.list", HistoryListPayload),
  cmd("history.get", HistoryGetPayload),
  cmd("history.tool", HistoryToolPayload),
  cmd("history.search", HistorySearchPayload),
  cmd("history.resume", HistoryResumePayload),
  cmd("history.watch", z.object({}).strict()),
] as const;

/** The `data` of each history command's ack; `CommandResults` extends it. */
export interface HistoryResults {
  "history.list": HistoryListResult;
  "history.get": HistoryGetResult;
  "history.tool": HistoryToolResult;
  "history.search": HistorySearchResult;
  "history.resume": SessionCreateResult;
  "history.watch": undefined;
}
