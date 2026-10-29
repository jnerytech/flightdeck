import { z } from "zod";

export const PROTOCOL_VERSION = 1;
/** Oldest client protocol this daemon still serves. */
export const MIN_PROTOCOL_VERSION = 1;
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

/** Name, pinned and archived of a session (phase 5), set with `session.meta.set`. */
export const SessionMeta = z.object({
  name: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

/** Phase 5 additions to every session list: the project group and the meta. */
const ListExtras = {
  projectKey: z.string().nullable().optional(),
  meta: SessionMeta.optional(),
};

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
  ...ListExtras,
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
  /** Protocol the client speaks; 1 when absent (clients before phase 7). */
  protocolVersion: z.number().int().optional(),
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
  /** Workflow run of the active run; `null` for a simple card (phase 4). */
  workflowRunId: z.string().nullable().default(null),
  /** Why a queued card waits: a free slot, or the host's plan quota (phase 7). */
  queueReason: z.enum(["slot", "quota"]).nullable().default(null),
  /** With `queueReason: quota`, when the window resets (ISO); `null` when unknown. */
  quotaUntil: z.string().nullable().default(null),
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

// Phase 6: workflows declared in `.flightdeck/workflows/<name>.yaml` on the base branch.
export const WorkflowInfo = z.object({
  /** The file name without `.yaml`. */
  name: z.string(),
  /** sha256 of the file on the base branch; trust is given to this exact content. */
  hash: z.string(),
  trusted: z.boolean(),
  /** Every `check` command, the only shell commands the workflow can run. */
  checks: z.array(z.string()),
  /** Validation errors; a workflow with any can neither be trusted nor run. */
  errors: z.array(z.string()),
  inputs: z.array(z.string()),
});
export type WorkflowInfo = z.infer<typeof WorkflowInfo>;

/**
 * `waiting`: a gate is open. `paused`: budget or loop limit reached. `failed`: a step (or the
 * card's preparation) failed. The last four are final.
 */
export const RunStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "paused",
  "failed",
  "rejected",
  "completed",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepType = z.enum(["agent", "check", "gate", "loop", "parallel", "pr"]);
export type StepType = z.infer<typeof StepType>;

export const StepStatus = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "approved",
  "rejected",
]);
export type StepStatus = z.infer<typeof StepStatus>;

/**
 * One attempt of one step. Inside a loop the check is `<id>.check` and the action `<id>.do`,
 * with the iteration as attempt; parallel items are `<id>.<index>`.
 */
export const StepRun = z.object({
  stepId: z.string(),
  attempt: z.number().int().min(1),
  type: StepType,
  status: StepStatus,
  /** Session of an `agent` step: its conversation. */
  sessionId: z.string().nullable(),
  /** Assistant text of the turn, the last 8 KB of a check, the text shown by a gate. */
  output: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  /** The note given when answering a gate. */
  note: z.string().nullable(),
  /** The question of a gate. */
  message: z.string().nullable(),
  /** What the turns of an `agent` step spent; `null` for the other steps. */
  usage: z
    .object({
      turns: z.number().int().nonnegative(),
      minutes: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
    })
    .nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type StepRun = z.infer<typeof StepRun>;

export const RunBudget = z.object({
  maxTurns: z.number().optional(),
  maxMinutes: z.number().optional(),
  maxCostUsd: z.number().optional(),
});
export type RunBudget = z.infer<typeof RunBudget>;

/** Summed over every session of the run; the cost is what the SDK reports (an estimate). */
export const RunUsage = z.object({
  turns: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type RunUsage = z.infer<typeof RunUsage>;

export const WorkflowRun = z.object({
  id: z.string(),
  cardId: z.string(),
  workflowName: z.string(),
  workflowHash: z.string(),
  status: RunStatus,
  statusReason: z.string().nullable(),
  budget: RunBudget,
  usage: RunUsage,
  inputs: z.record(z.string(), z.string()),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** In the order they started. */
  steps: z.array(StepRun),
  /** Waiting for the plan quota before the next agent turn: until when (ISO) (phase 7). */
  quotaUntil: z.string().nullable().default(null),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

// Phase 7 (track B): the plan quota of a host, read from its managed sessions.
export const QuotaWindow = z.object({
  /** `five_hour`, `seven_day` or any other window the CLI reports. */
  window: z.string(),
  /** Fraction from 0 to 1; `null` when the CLI did not say. */
  utilization: z.number().nullable(),
  status: z.enum(["allowed", "allowed_warning", "rejected"]),
  resetsAt: z.string().nullable(),
  /** When this reading arrived: the app shows its age. */
  readAt: z.string(),
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;

export const QuotaState = z.object({
  /** Valid readings only: one past its `resetsAt` is dropped until a new one comes. */
  windows: z.array(QuotaWindow),
  /** From this utilization new cards wait for the window to reset; `null` when off. */
  pauseAt: z.number().nullable(),
});
export type QuotaState = z.infer<typeof QuotaState>;

/** Usage of the host's managed sessions in one day (host time zone) and project. */
export const UsageRow = z.object({
  /** `YYYY-MM-DD`. */
  day: z.string(),
  projectKey: z.string(),
  /** What the SDK reports (an estimate on a subscription). */
  costUsd: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  turns: z.number().int(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageSummary = z.object({
  days: z.number().int(),
  /** Newest day first, then by project. */
  rows: z.array(UsageRow),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

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
/** Phase 6: with `workflow`, the card runs that trusted workflow with `inputs`. */
export const CardStartPayload = z.object({
  cardId: z.string(),
  workflow: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
});
export const GateRespondPayload = z.object({
  runId: z.string(),
  stepId: z.string().min(1),
  attempt: z.number().int().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
});
/** Completion and discard only happen with `confirm: true`; the daemon refuses anything else. */
export const CardConfirmPayload = z.object({ cardId: z.string(), confirm: z.boolean().optional() });

// Phase 5: sessions started outside Flightdeck (terminal), seen through Claude Code hooks.
export const ExternalStatus = z.enum([
  "idle",
  "running",
  "awaiting_permission",
  "ended",
  "unknown",
]);
export type ExternalStatus = z.infer<typeof ExternalStatus>;

export const ExternalSession = z.object({
  claudeSessionId: z.string(),
  cwd: z.string().nullable(),
  transcriptPath: z.string().nullable(),
  source: z.string().nullable(),
  status: ExternalStatus,
  statusReason: z.string().nullable(),
  launchId: z.string().nullable(),
  /** A channel of `flightdeckd claude` is connected: it takes `external.message`. */
  controllable: z.boolean(),
  projectKey: z.string().nullable(),
  startedAt: z.string(),
  lastEventAt: z.string(),
  endedAt: z.string().nullable(),
  meta: SessionMeta.optional(),
});
export type ExternalSession = z.infer<typeof ExternalSession>;

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
  cmd("card.start", CardStartPayload),
  cmd("card.get", CardIdPayload),
  cmd("card.stop", CardIdPayload),
  cmd("card.diff", CardIdPayload),
  cmd("card.message", z.object({ cardId: z.string(), text: z.string().min(1) })),
  cmd("card.pr.create", CardIdPayload),
  cmd("card.complete", CardConfirmPayload),
  cmd("card.discard", CardConfirmPayload),
  cmd("external.list", z.object({}).strict()),
  cmd("external.watch", z.object({}).strict()),
  /** Only for sessions opened with `flightdeckd claude` (`controllable`). */
  cmd(
    "session.meta.set",
    z.object({
      claudeSessionId: z.string().min(1),
      name: z.string().nullable().optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
    }),
  ),
  cmd("maintenance.status", z.object({}).strict()),
  cmd("maintenance.backup", z.object({}).strict()),
  /** Applies the retention policy now; `dryRun` only counts. */
  cmd("maintenance.prune", z.object({ dryRun: z.boolean().optional() })),
  /** Phase 7: the daemon acks, then closes as on SIGTERM and exits with 0. */
  cmd("daemon.shutdown", z.object({}).strict()),
  cmd("hooks.status", z.object({}).strict()),
  /** Writes to the host user's ~/.claude/settings.json: only with `confirm: true`. */
  cmd("hooks.install", z.object({ confirm: z.boolean().optional() })),
  cmd("hooks.uninstall", z.object({ confirm: z.boolean().optional() })),
  cmd("external.message", z.object({ claudeSessionId: z.string(), text: z.string().min(1) })),
  // Phase 6: workflows of a project (read from its base branch) and their runs.
  cmd("workflow.list", z.object({ projectId: z.string() })),
  cmd("workflow.validate", z.object({ projectId: z.string(), name: z.string().min(1) })),
  /** `hash` is the content the user reviewed; a workflow that changed since is refused. */
  cmd(
    "workflow.trust",
    z.object({ projectId: z.string(), name: z.string().min(1), hash: z.string().min(1) }),
  ),
  cmd("run.get", z.object({ runId: z.string() })),
  cmd("run.watch", z.object({}).strict()),
  /** Only the user answers gates: there is no MCP tool for it. */
  cmd("gate.respond", GateRespondPayload),
  // Phase 7 (track B).
  cmd("quota.get", z.object({}).strict()),
  cmd("quota.watch", z.object({}).strict()),
  cmd("usage.summary", z.object({ days: z.number().int().min(1).max(90).optional() })),
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
  /** What the daemon offers (`central`, `workflows`, `maintenance`…); absent before phase 7. */
  features: z.array(z.string()).optional(),
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

export const HooksStatusResult = z.object({
  status: z.enum(["installed", "absent", "outdated"]),
  /** The settings.json the hooks go to. */
  settingsPath: z.string(),
  /** Receptor of this daemon, `null` until hooks are installed. */
  receptorUrl: z.string().nullable(),
});
export type HooksStatusResult = z.infer<typeof HooksStatusResult>;

/** Phase 7: one backup file of the host's database. */
export const BackupInfo = z.object({ path: z.string(), at: z.string(), bytes: z.number() });
export type BackupInfo = z.infer<typeof BackupInfo>;

/** Rows removed (or that would be, with `dryRun`) per table. */
export const PruneCounts = z.record(z.string(), z.number());
export type PruneCounts = z.infer<typeof PruneCounts>;

export const MaintenanceStatus = z.object({
  /** Size of the database (pages × page size). */
  dbBytes: z.number(),
  lastBackup: BackupInfo.nullable(),
  /** Automatic backups, newest first. */
  backups: z.array(BackupInfo),
  lastPrune: z.object({ at: z.string(), dryRun: z.boolean(), counts: PruneCounts }).nullable(),
  counts: z.object({ sessions: z.number(), events: z.number(), externalSessions: z.number() }),
});
export type MaintenanceStatus = z.infer<typeof MaintenanceStatus>;

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
  "external.list": { sessions: ExternalSession[] };
  "external.watch": undefined;
  "external.message": undefined;
  "session.meta.set": SessionMeta & { claudeSessionId: string };
  "maintenance.status": MaintenanceStatus;
  "maintenance.backup": BackupInfo;
  "maintenance.prune": PruneCounts;
  "daemon.shutdown": undefined;
  "hooks.status": HooksStatusResult;
  "hooks.install": HooksStatusResult;
  "hooks.uninstall": HooksStatusResult;
  "card.get": Card;
  "workflow.list": { workflows: WorkflowInfo[] };
  "workflow.validate": WorkflowInfo;
  "workflow.trust": WorkflowInfo;
  "run.get": WorkflowRun;
  "run.watch": undefined;
  "gate.respond": WorkflowRun;
  "quota.get": QuotaState;
  "quota.watch": undefined;
  "usage.summary": UsageSummary;
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
  "protocol_incompatible",
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

/** Sent after `external.watch` with the whole external session after each change. */
export const ExternalUpdated = z.object({
  type: z.literal("external.updated"),
  session: ExternalSession,
});
export type ExternalUpdated = z.infer<typeof ExternalUpdated>;

/** A permission request of an external session opened or closed (after `external.watch`). */
export const ExternalPermissionFrame = z.object({
  type: z.literal("external.permission"),
  /** Starts with `ext-`, so it never collides with a managed session's; answer with `permission.respond`. */
  requestId: z.string(),
  claudeSessionId: z.string(),
  toolName: z.string(),
  /** Tool input with long strings cut. */
  input: z.record(z.string(), z.unknown()),
  state: z.enum(["open", "closed"]),
  /** Why it closed: answered here, the hook connection dropped, or answered in the terminal. */
  resolution: z.enum(["allow", "deny", "dropped", "answered_elsewhere"]).optional(),
  createdAt: z.string(),
});
export type ExternalPermissionFrame = z.infer<typeof ExternalPermissionFrame>;

/** Sent after `run.watch` with the whole workflow run after each change. Not a session event. */
export const RunUpdated = z.object({ type: z.literal("run.updated"), run: WorkflowRun });
export type RunUpdated = z.infer<typeof RunUpdated>;

/** Sent after `quota.watch` with the host's windows after each new reading or expiry. */
export const QuotaUpdated = z.object({ type: z.literal("quota.updated"), ...QuotaState.shape });
export type QuotaUpdated = z.infer<typeof QuotaUpdated>;

export const ServerMessage = z.union([
  AckOk,
  AckError,
  EventEnvelope,
  Ping,
  HistoryChanged,
  CardUpdated,
  ExternalUpdated,
  ExternalPermissionFrame,
  RunUpdated,
  QuotaUpdated,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parses a raw JSON frame into a `ServerMessage`, throwing on invalid input. */
export function parseServerMessage(raw: string): ServerMessage {
  return ServerMessage.parse(JSON.parse(raw));
}

export * from "./pairing.ts";
