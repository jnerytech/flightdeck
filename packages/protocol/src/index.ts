import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const WS_PATH = "/v1/ws";

/** Close code used when authentication fails or a frame arrives before `hello`. */
export const CLOSE_UNAUTHORIZED = 4401;

/** Close code used when a client misses two heartbeats in a row. */
export const CLOSE_HEARTBEAT = 4408;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const SessionStatus = z.enum([
  "starting",
  "running",
  "awaiting_permission",
  "idle",
  "ended",
  "error",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const PermissionMode = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const ToolInput = z.record(z.string(), z.unknown());
export type ToolInput = z.infer<typeof ToolInput>;

export const SessionSummary = z.object({
  id: z.string(),
  name: z.string().nullable(),
  cwd: z.string(),
  status: SessionStatus,
  permissionMode: PermissionMode,
  model: z.string().nullable(),
  claudeSessionId: z.string().nullable(),
  lastSeq: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// ---------------------------------------------------------------------------
// Session events (daemon → client, inside the `event` envelope)
// ---------------------------------------------------------------------------

export const AssistantBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
]);
export type AssistantBlock = z.infer<typeof AssistantBlock>;

export const PermissionResolution = z.enum(["allow", "deny", "cancelled", "expired"]);
export type PermissionResolution = z.infer<typeof PermissionResolution>;

export const Usage = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof Usage>;

/** An open permission request, as listed in `session.summary`. */
export const PendingPermission = z.object({
  requestId: z.string(),
  toolName: z.string(),
  createdAt: z.string(),
});
export type PendingPermission = z.infer<typeof PendingPermission>;

export const SessionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    cwd: z.string(),
    name: z.string().nullable(),
    permissionMode: PermissionMode,
  }),
  z.object({
    type: z.literal("session.status"),
    status: SessionStatus,
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("session.init"),
    claudeSessionId: z.string(),
    model: z.string(),
    tools: z.array(z.string()),
  }),
  z.object({ type: z.literal("message.user"), text: z.string() }),
  z.object({ type: z.literal("message.assistant"), blocks: z.array(AssistantBlock) }),
  z.object({ type: z.literal("message.delta"), text: z.string() }),
  z.object({
    type: z.literal("tool.result"),
    toolUseId: z.string(),
    content: z.string(),
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal("permission.requested"),
    requestId: z.string(),
    toolName: z.string(),
    input: ToolInput,
  }),
  z.object({
    type: z.literal("permission.resolved"),
    requestId: z.string(),
    decision: PermissionResolution,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn.result"),
    subtype: z.string(),
    isError: z.boolean(),
    durationMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    usage: Usage.optional(),
  }),
  z.object({ type: z.literal("session.error"), code: z.string(), message: z.string() }),
  z.object({
    type: z.literal("session.summary"),
    sessionId: z.string(),
    name: z.string().nullable(),
    cwd: z.string(),
    status: SessionStatus,
    /** Open requests, oldest first; the count is its length. */
    pendingPermissions: z.array(PendingPermission),
    updatedAt: z.string(),
  }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;
export type SessionEventType = SessionEvent["type"];
export type SessionEventOf<T extends SessionEventType> = Extract<SessionEvent, { type: T }>;

/** Events that are sent live but never persisted nor replayed. */
export const EPHEMERAL_EVENTS: ReadonlySet<SessionEventType> = new Set([
  "message.delta",
  "session.summary",
]);

// ---------------------------------------------------------------------------
// Commands (client → daemon)
// ---------------------------------------------------------------------------

export const HelloPayload = z.object({
  token: z.string().min(1),
  client: z.string().min(1),
});

export const SessionListPayload = z.object({}).strict();

export const SessionCreatePayload = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  name: z.string().min(1).optional(),
  permissionMode: PermissionMode.optional(),
  model: z.string().min(1).optional(),
});

export const SessionSendPayload = z.object({ sessionId: z.string(), text: z.string().min(1) });
export const SessionIdPayload = z.object({ sessionId: z.string() });
export const SessionSubscribePayload = z.object({
  sessionId: z.string(),
  sinceSeq: z.number().int().nonnegative().optional(),
});

export const PermissionRespondPayload = z.object({
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
  message: z.string().optional(),
  updatedInput: ToolInput.optional(),
});

// Phase 3: transcripts indexed from ~/.claude/projects (read only).
export const HistoryOrigin = z.enum(["flightdeck", "external"]);
export type HistoryOrigin = z.infer<typeof HistoryOrigin>;

/** Pages are addressed by an opaque cursor taken from the previous answer. */
const Cursor = z.string().min(1);

export const HistoryListPayload = z.object({
  cwd: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  origin: HistoryOrigin.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: Cursor.optional(),
});

export const HistoryGetPayload = z.object({
  claudeSessionId: z.string().min(1),
  cursor: Cursor.optional(),
  limit: z.number().int().min(1).max(500).optional(),
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

// Phase 4: projects (git repositories of the host) and their boards of cards.
export const PrProviderKind = z.enum(["github", "azure-devops", "none"]);
export type PrProviderKind = z.infer<typeof PrProviderKind>;

export const BoardColumn = z.enum(["backlog", "in_progress", "waiting", "review", "done"]);
export type BoardColumn = z.infer<typeof BoardColumn>;

export const PrState = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof PrState>;

export const ChecksState = z.enum(["pending", "passing", "failing"]);
export type ChecksState = z.infer<typeof ChecksState>;

export const Project = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  baseBranch: z.string(),
  prProvider: PrProviderKind,
  /** The only shell command Flightdeck runs on its own, and only when registered. */
  setupScript: z.string().nullable(),
  /** Appended to the prompt of every card. */
  promptTemplate: z.string(),
});
export type Project = z.infer<typeof Project>;

export const CardRun = z.object({
  /** `null` while queued or preparing the worktree. */
  sessionId: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type CardRun = z.infer<typeof CardRun>;

export const Card = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  column: BoardColumn,
  /** Moved by hand to Backlog or Concluído: events leave it there until the next start. */
  columnLocked: z.boolean(),
  position: z.number(),
  slug: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  prUrl: z.string().nullable(),
  prState: PrState.nullable(),
  checksState: ChecksState.nullable(),
  /** Started and waiting for a free slot. */
  queued: z.boolean(),
  /** Session of the active (latest) run. */
  sessionId: z.string().nullable(),
  sessionStatus: SessionStatus.nullable(),
  /** Last problem worth showing on the card (failed setup, worktree kept on completion). */
  notice: z.string().nullable(),
  /** Set only on the last update of a discarded card, which leaves the board. */
  discarded: z.boolean(),
  runs: z.array(CardRun),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof Card>;

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
  hunks: z.array(DiffHunk),
});
export type DiffFile = z.infer<typeof DiffFile>;

export const CardDiff = z.object({ base: z.string(), files: z.array(DiffFile) });
export type CardDiff = z.infer<typeof CardDiff>;

const ProjectFields = {
  name: z.string().min(1).optional(),
  baseBranch: z.string().min(1).optional(),
  prProvider: PrProviderKind.optional(),
  /** `null` or blank removes the script. */
  setupScript: z.string().nullable().optional(),
  promptTemplate: z.string().optional(),
};

export const ProjectAddPayload = z.object({ path: z.string().min(1), ...ProjectFields });
export const ProjectUpdatePayload = z.object({ projectId: z.string(), ...ProjectFields });
export const CardIdPayload = z.object({ cardId: z.string() });
/** Completion and discard only happen with `confirm: true`; the daemon refuses anything else. */
export const CardConfirmPayload = z.object({ cardId: z.string(), confirm: z.boolean().optional() });

const cmd = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ id: z.string().min(1), type: z.literal(type), payload });

export const Command = z.discriminatedUnion("type", [
  cmd("hello", HelloPayload),
  cmd("session.list", SessionListPayload),
  cmd("session.create", SessionCreatePayload),
  cmd("session.send", SessionSendPayload),
  cmd("session.interrupt", SessionIdPayload),
  cmd("session.close", SessionIdPayload),
  cmd("session.resume", SessionIdPayload),
  cmd("session.subscribe", SessionSubscribePayload),
  cmd("session.unsubscribe", SessionIdPayload),
  cmd("permission.respond", PermissionRespondPayload),
  cmd("sessions.watch", z.object({}).strict()),
  cmd("host.info", z.object({}).strict()),
  cmd("history.list", HistoryListPayload),
  cmd("history.get", HistoryGetPayload),
  cmd("history.search", HistorySearchPayload),
  cmd("history.resume", HistoryResumePayload),
  cmd("history.watch", z.object({}).strict()),
  cmd("project.list", z.object({}).strict()),
  cmd("project.add", ProjectAddPayload),
  cmd("project.update", ProjectUpdatePayload),
  cmd("board.get", z.object({ projectId: z.string() })),
  /** Host-wide board settings; without fields it only reads them. */
  cmd("board.settings", z.object({ maxParallelRuns: z.number().int().min(1).optional() })),
  cmd("board.watch", z.object({}).strict()),
  cmd(
    "card.create",
    z.object({ projectId: z.string(), title: z.string().min(1), description: z.string() }),
  ),
  cmd(
    "card.update",
    z.object({
      cardId: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
    }),
  ),
  cmd(
    "card.move",
    z.object({ cardId: z.string(), column: BoardColumn, position: z.number().optional() }),
  ),
  cmd("card.start", CardIdPayload),
  cmd("card.stop", CardIdPayload),
  cmd("card.diff", CardIdPayload),
  cmd("card.message", z.object({ cardId: z.string(), text: z.string().min(1) })),
  cmd("card.pr.create", CardIdPayload),
  cmd("card.complete", CardConfirmPayload),
  cmd("card.discard", CardConfirmPayload),
]);
export type Command = z.infer<typeof Command>;
export type CommandType = Command["type"];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;
export type CommandPayload<T extends CommandType> = CommandOf<T>["payload"];

/** Loose shape used to recover the command id when the full schema fails. */
export const CommandHeader = z.object({ id: z.string().min(1), type: z.string() });

// ---------------------------------------------------------------------------
// Command results (the `data` of a successful ack)
// ---------------------------------------------------------------------------

export const HelloResult = z.object({
  hostName: z.string(),
  daemonVersion: z.string(),
  protocolVersion: z.number().int(),
  allowedRoots: z.array(z.string()),
});
export type HelloResult = z.infer<typeof HelloResult>;

export const HostInfoResult = z.object({
  hostName: z.string(),
  os: z.string(),
  arch: z.string(),
  daemonVersion: z.string(),
  claudeVersion: z.string().nullable(),
  claudePath: z.string().nullable(),
  uptimeSec: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  apiKeySanitized: z.boolean(),
});
export type HostInfoResult = z.infer<typeof HostInfoResult>;

export const SessionListResult = z.object({ sessions: z.array(SessionSummary) });
export type SessionListResult = z.infer<typeof SessionListResult>;

export const SessionCreateResult = z.object({ sessionId: z.string() });
export type SessionCreateResult = z.infer<typeof SessionCreateResult>;

export const SessionSendResult = z.object({ queued: z.boolean() });
export type SessionSendResult = z.infer<typeof SessionSendResult>;

export const SessionSubscribeResult = z.object({
  session: SessionSummary,
  replayed: z.number().int().nonnegative(),
});
export type SessionSubscribeResult = z.infer<typeof SessionSubscribeResult>;

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
});
export type HistoryListResult = z.infer<typeof HistoryListResult>;

export const HistoryGetResult = z.object({
  session: HistorySessionSummary,
  messages: z.array(HistoryMessage),
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
});
export type HistoryGetResult = z.infer<typeof HistoryGetResult>;

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

export const BoardSettings = z.object({ maxParallelRuns: z.number().int().min(1) });
export type BoardSettings = z.infer<typeof BoardSettings>;

export const ProjectListResult = z.object({
  projects: z.array(Project),
  /** Host-wide limit of cards running at the same time. */
  maxParallelRuns: z.number().int().min(1),
});
export type ProjectListResult = z.infer<typeof ProjectListResult>;

export const BoardResult = z.object({
  project: Project,
  /** The five columns, in board order, each with its cards by position. */
  columns: z.array(z.object({ column: BoardColumn, cards: z.array(Card) })),
});
export type BoardResult = z.infer<typeof BoardResult>;

export interface CommandResults {
  hello: HelloResult;
  "session.list": SessionListResult;
  "session.create": SessionCreateResult;
  "session.send": SessionSendResult;
  "session.interrupt": undefined;
  "session.close": undefined;
  "session.resume": undefined;
  "session.subscribe": SessionSubscribeResult;
  "session.unsubscribe": undefined;
  "permission.respond": undefined;
  "sessions.watch": undefined;
  "host.info": HostInfoResult;
  "history.list": HistoryListResult;
  "history.get": HistoryGetResult;
  "history.search": HistorySearchResult;
  "history.resume": SessionCreateResult;
  "history.watch": undefined;
  "project.list": ProjectListResult;
  "project.add": Project;
  "project.update": Project;
  "board.get": BoardResult;
  "board.settings": BoardSettings;
  "board.watch": undefined;
  "card.create": Card;
  "card.update": Card;
  "card.move": Card;
  "card.start": Card;
  "card.stop": Card;
  "card.diff": CardDiff;
  "card.message": SessionSendResult;
  "card.pr.create": Card;
  "card.complete": Card;
  "card.discard": Card;
}

// ---------------------------------------------------------------------------
// Server messages (daemon → client)
// ---------------------------------------------------------------------------

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "invalid_state",
  "forbidden_cwd",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const AckOk = z.object({
  type: z.literal("ack"),
  id: z.string(),
  ok: z.literal(true),
  data: z.unknown().optional(),
});
export const AckError = z.object({
  type: z.literal("ack"),
  id: z.string(),
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
export const Ack = z.union([AckOk, AckError]);
export type Ack = z.infer<typeof Ack>;

export const EventEnvelope = z.object({
  type: z.literal("event"),
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  event: SessionEvent,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Heartbeat sent by the daemon; `lastRttMs` is the round trip of the previous ping. */
export const Ping = z.object({
  type: z.literal("ping"),
  id: z.string(),
  lastRttMs: z.number().nonnegative().optional(),
});
export type Ping = z.infer<typeof Ping>;

/** Client answer to a `ping`, echoing its id. Control frame: no ack. */
export const Pong = z.object({ type: z.literal("pong"), id: z.string() });
export type Pong = z.infer<typeof Pong>;

/** Sent after `history.watch` whenever a transcript gains lines. Not a session event. */
export const HistoryChanged = z.object({
  type: z.literal("history.changed"),
  claudeSessionId: z.string(),
  cwd: z.string(),
  lastTs: z.string().nullable(),
  maybeActive: z.boolean(),
});
export type HistoryChanged = z.infer<typeof HistoryChanged>;

/** Sent after `board.watch` with the whole card after each change. Not a session event. */
export const CardUpdated = z.object({ type: z.literal("card.updated"), card: Card });
export type CardUpdated = z.infer<typeof CardUpdated>;

export const ServerMessage = z.union([
  AckOk,
  AckError,
  EventEnvelope,
  Ping,
  HistoryChanged,
  CardUpdated,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parses a raw JSON frame into a `ServerMessage`, throwing on invalid input. */
export function parseServerMessage(raw: string): ServerMessage {
  return ServerMessage.parse(JSON.parse(raw));
}

export * from "./pairing.ts";
