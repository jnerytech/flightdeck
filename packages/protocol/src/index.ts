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

const PersonaEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

/** What the form sends for a persona (phase 20): a role the Claude takes, with its suggestions. */
export const PersonaInput = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    model: z.string().optional(),
    effort: PersonaEffort.optional(),
    /** Only restricts: the tools the persona may use; absent means the session's own. */
    tools: z.array(z.string()).optional(),
    /** A suggestion, never above the session's mode. */
    permissionMode: PermissionMode.optional(),
    /** The text added to the system prompt, at most 8 KB and with no secret. */
    body: z.string(),
  })
  .strict();
export type PersonaInput = z.infer<typeof PersonaInput>;

/** A persona in its normal form: every optional field is `null` when absent. */
export const PersonaFields = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  model: z.string().nullable(),
  effort: PersonaEffort.nullable(),
  tools: z.array(z.string()).nullable(),
  permissionMode: PermissionMode.nullable(),
  body: z.string(),
});
export type PersonaFields = z.infer<typeof PersonaFields>;

/** The persona of a session, as the lists and the timeline show it. */
export const SessionPersona = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
export type SessionPersona = z.infer<typeof SessionPersona>;

/**
 * Which persona to use: an `id` (the project's, else the host's, else the pack's) or a whole
 * `definition` (the app's global ones live in the app). `language` picks the pack's language.
 */
export const PersonaRef = z
  .object({
    id: z.string().optional(),
    definition: PersonaInput.optional(),
    language: z.enum(["pt-BR", "en"]).optional(),
  })
  .strict()
  .refine((ref) => (ref.id === undefined) !== (ref.definition === undefined), {
    message: "informe id ou definition, um dos dois",
  });
export type PersonaRef = z.infer<typeof PersonaRef>;

export const ToolInput = z.record(z.string(), z.unknown());
export type ToolInput = z.infer<typeof ToolInput>;

/** Name, pinned and archived of a session (phase 5), set with `session.meta.set`. */
export const SessionMeta = z.object({
  name: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

/**
 * Phase 8 (track B): one line about a session for the lists, derived from its transcript and its
 * live state, without AI. The app formats it ("Pedido: … · rodando Bash").
 */
export const SessionLine = z.object({
  /** First line of the user's last prompt, up to 80 characters. */
  request: z.string().nullable(),
  state: z.enum(["running", "waiting", "idle", "ended"]),
  /** Running: the last tool called; waiting: the tool asking for approval. */
  tool: z.string().nullable(),
  /** Last activity: an idle session is idle since then. */
  since: z.string().nullable(),
});
export type SessionLine = z.infer<typeof SessionLine>;

/** Phase 5 additions to every session list: the project group and the meta (and phase 8's line). */
const ListExtras = {
  projectKey: z.string().nullable().optional(),
  meta: SessionMeta.optional(),
  summary: SessionLine.optional(),
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
  /** The persona the session was opened with (phase 20). */
  persona: SessionPersona.nullable().optional(),
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

/** Phase 13: the risk of a permission request, from declared rules (never from AI). */
export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Phase 13: how a request was approved automatically: by rule (low risk) or by the AI. */
export const AutoApproval = z.object({
  by: z.enum(["rule", "ai"]),
  reason: z.string(),
  model: z.string().nullable(),
});
export type AutoApproval = z.infer<typeof AutoApproval>;

/** Phase 13: one decision of the automatic approval. */
export const AutoApprovalRecord = z.object({
  id: z.string(),
  projectId: z.string(),
  /** The managed session's id, or the terminal session's Claude id. */
  sessionKey: z.string(),
  requestId: z.string(),
  toolName: z.string(),
  risk: z.string(),
  decision: z.enum(["allow", "ask"]),
  reason: z.string(),
  by: z.enum(["rule", "ai"]),
  model: z.string().nullable(),
  at: z.string(),
});
export type AutoApprovalRecord = z.infer<typeof AutoApprovalRecord>;

export const AutoApproveSuspension = z.object({
  sessionKey: z.string(),
  reason: z.string(),
  at: z.string(),
});
export type AutoApproveSuspension = z.infer<typeof AutoApproveSuspension>;

/** An open permission request, as listed in `session.summary`. */
export const PendingPermission = z.object({
  requestId: z.string(),
  toolName: z.string(),
  createdAt: z.string(),
  /** Phase 8: the tool input with long strings cut, for the tray's "ferramenta: resumo". */
  input: z.record(z.string(), z.unknown()).optional(),
  /** Phase 13; optional only because older daemons do not send it. */
  risk: RiskLevel.optional(),
  riskReason: z.string().optional(),
});
export type PendingPermission = z.infer<typeof PendingPermission>;

// Phase 7 (track B): the SDK's PermissionUpdate, for "permitir nesta sessão / sempre neste projeto".
export const PermissionDestination = z.enum([
  "userSettings",
  "projectSettings",
  "localSettings",
  "session",
  "cliArg",
]);
export type PermissionDestination = z.infer<typeof PermissionDestination>;

export const PermissionRule = z.object({
  toolName: z.string(),
  ruleContent: z.string().optional(),
});
export type PermissionRule = z.infer<typeof PermissionRule>;

const RulesUpdate = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    rules: z.array(PermissionRule),
    behavior: z.enum(["allow", "deny", "ask"]),
    destination: PermissionDestination,
  });
const DirectoriesUpdate = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    directories: z.array(z.string()),
    destination: PermissionDestination,
  });

export const PermissionUpdate = z.discriminatedUnion("type", [
  RulesUpdate("addRules"),
  RulesUpdate("replaceRules"),
  RulesUpdate("removeRules"),
  z.object({
    type: z.literal("setMode"),
    mode: PermissionMode,
    destination: PermissionDestination,
  }),
  DirectoriesUpdate("addDirectories"),
  DirectoriesUpdate("removeDirectories"),
]);
export type PermissionUpdate = z.infer<typeof PermissionUpdate>;

export const SessionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    cwd: z.string(),
    name: z.string().nullable(),
    permissionMode: PermissionMode,
    persona: SessionPersona.optional(),
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
  /** A persona was applied to the session (it is conversation instruction, not system prompt). */
  z.object({ type: z.literal("persona.applied"), persona: SessionPersona }),
  /** The role was left: back to normal behavior. */
  z.object({ type: z.literal("persona.cleared"), persona: SessionPersona }),
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
    /** What the CLI offers to stop asking (phase 7). */
    suggestions: z.array(PermissionUpdate).optional(),
    /** Phase 13; optional only because events stored before it do not have it. */
    risk: RiskLevel.optional(),
    riskReason: z.string().optional(),
  }),
  z.object({
    type: z.literal("permission.resolved"),
    requestId: z.string(),
    decision: PermissionResolution,
    message: z.string().optional(),
    /** Phase 13: approved automatically, and why. */
    auto: AutoApproval.optional(),
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

/** How hard the model works (the SDK's effort levels). */
export const EffortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const SessionCreatePayload = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  name: z.string().min(1).optional(),
  permissionMode: PermissionMode.optional(),
  model: z.string().min(1).optional(),
  /** Phase 13: for a session that is not resumed later (arena variants). */
  effort: EffortLevel.optional(),
  /** Opens the session in a persona's role (phase 20). */
  persona: PersonaRef.optional(),
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
  /** Only the request's own suggestions or a project rule; anything else is refused. */
  updatedPermissions: z.array(PermissionUpdate).optional(),
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

/** Phase 13: the project's automatic approval, off by default. */
export const AutoApproveSettings = z.object({
  enabled: z.boolean().default(false),
  model: z.string().min(1).default("claude-haiku-5-5"),
  /** Low risk approved without asking the AI. */
  lowWithoutAi: z.boolean().default(true),
});
export type AutoApproveSettings = z.infer<typeof AutoApproveSettings>;

/** Phase 13: what fires an automation. */
export const AutomationTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expr: z.string().min(1), tz: z.string().min(1) }),
  z.object({ type: z.literal("pr_comment") }),
  z.object({ type: z.literal("ci_failed") }),
  z.object({ type: z.literal("issue_label"), label: z.string().min(1) }),
]);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/** Phase 13: what an automation does. */
export const AutomationAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_workflow"),
    workflow: z.string().min(1),
    inputs: z.record(z.string(), z.string()).optional(),
    /** The new card's title (the automation's name when absent) and description. */
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({ type: z.literal("send_to_card") }),
  z.object({ type: z.literal("create_card") }),
]);
export type AutomationAction = z.infer<typeof AutomationAction>;

/** Phase 13: an automation of a project; born off, and turned on only with a confirmation. */
export const Automation = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: AutomationTrigger,
  action: AutomationAction,
  maxRunsPerDay: z.number().int(),
  /** Act on content from third parties too (always marked untrusted, with auto-approval suspended). */
  allowExternalAuthors: z.boolean(),
  createdAt: z.string(),
});
export type Automation = z.infer<typeof Automation>;

export const AutomationRun = z.object({
  id: z.string(),
  automationId: z.string(),
  firedAt: z.string(),
  cause: z.string(),
  status: z.enum(["ok", "failed", "ignored", "skipped", "limited", "missed"]),
  detail: z.string().nullable(),
});
export type AutomationRun = z.infer<typeof AutomationRun>;

/** Phase 13: where a project's issues come from, and whether a PR comments on its issue. */
export const IssuesConfig = z.object({
  provider: z.enum(["github", "azure"]),
  /** GitHub search or Azure WIQL; the default is "assigned to me, open". */
  query: z.string().min(1).optional(),
  /** Off by default: a comment on the issue is a write to the provider. */
  commentOnPr: z.boolean().default(false),
});
export type IssuesConfig = z.infer<typeof IssuesConfig>;

/** Phase 13: an issue (GitHub) or work item (Azure Boards). */
export const Issue = z.object({
  /** `github:owner/repo#n` or `azure:org/project#id`. */
  ref: z.string(),
  id: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  author: z.string(),
  labels: z.array(z.string()),
  /** Not you, nor (GitHub) an owner, member or collaborator: third-party content. */
  external: z.boolean(),
  createdAt: z.string(),
});
export type Issue = z.infer<typeof Issue>;
/** Which personas become subagents in a project: the pack and the project's, only the project's, or none. */
export const PersonaSubagentsMode = z.enum(["all", "project", "none"]);
export type PersonaSubagentsMode = z.infer<typeof PersonaSubagentsMode>;

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
  /** The repository has a `.worktreeinclude` (phase 11): the app suggests one when it has not. */
  worktreeInclude: z.boolean().default(false),
  /** Phase 13; filled in when an older daemon does not send it. */
  autoApprove: AutoApproveSettings.default(() => AutoApproveSettings.parse({})),
  /** Phase 13: `null` when the project has no issue integration. */
  issues: IssuesConfig.nullable().default(null),
  /** The persona a card opens its session in when it starts from that column (phase 20). */
  personaByColumn: z.partialRecord(BoardColumn, z.string()).default({}),
  /** The personas offered as `persona-<id>` subagents in this project (phase 20). */
  personaSubagents: PersonaSubagentsMode.default("all"),
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
  queueReason: z.enum(["slot", "quota", "budget"]).nullable().default(null),
  /** With `queueReason: quota`, when the window resets (ISO); `null` when unknown. */
  quotaUntil: z.string().nullable().default(null),
  /** Phase 13: an arena variant's parent card; variants are not on the board. */
  arenaOf: z.string().nullable().default(null),
  /** Phase 13: what makes an arena variant different from its siblings. */
  variant: z
    .object({
      label: z.string(),
      model: z.string().nullable(),
      effort: EffortLevel.nullable(),
      /** Phase 20: the id of the persona the variant runs in. */
      persona: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
  /** Phase 13: how many arena variants the card has (0 when it is not in an arena). */
  arenaVariants: z.number().int().nonnegative().default(0),
  /** Phase 13: the issue this card came from (`github:owner/repo#n`, `azure:org/project#id`). */
  issueRef: z.string().nullable().default(null),
  /** Phase 13: the issue's author is third party, so the card's content is untrusted. */
  issueExternal: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Card = z.infer<typeof Card>;

/** Phase 13: one variant of an arena, as the comparison shows it. */
export const ArenaVariant = z.object({
  /** The variant's own card id; `card.chooseVariant` takes it. */
  id: z.string(),
  label: z.string(),
  model: z.string().nullable(),
  effort: EffortLevel.nullable(),
  /** Phase 20: the id of the persona the variant runs in; `null` for none. */
  persona: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  /** Started and waiting for a free slot. */
  queued: z.boolean(),
  sessionStatus: SessionStatus.nullable(),
  column: BoardColumn,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  /** The estimated cost of its sessions; `null` when the host does not price them. */
  costUsd: z.number().nonnegative().nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }),
  ),
  /** The `check` steps of its workflow run, if it ran one. */
  checks: z.array(z.object({ stepId: z.string(), status: z.string() })),
  notice: z.string().nullable(),
});
export type ArenaVariant = z.infer<typeof ArenaVariant>;

export const Arena = z.object({ cardId: z.string(), variants: z.array(ArenaVariant) });
export type Arena = z.infer<typeof Arena>;

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

// Phase 11: review of the changes of any session or card.
/** `session:<claudeSessionId>` or `card:<id>`. */
export const ReviewTarget = z
  .string()
  .regex(/^(session|card):.+$/, "alvo session:<id> ou card:<id>");

export const ChangesResult = z.object({
  target: z.string(),
  /** The repository's top level (the card's worktree). */
  root: z.string(),
  /** The card's base branch; `null` for a session, whose diff is against `HEAD`. */
  base: z.string().nullable(),
  files: z.array(DiffFile),
  /** A card's commits ahead of and behind its base; `null` for a session. */
  position: z.object({ ahead: z.number().int(), behind: z.number().int() }).nullable(),
});
export type ChangesResult = z.infer<typeof ChangesResult>;

// Phase 14: terminals embedded in the host (a real shell behind a PTY).
export const TerminalInfo = z.object({
  terminalId: z.string(),
  cwd: z.string(),
  /** The program only, never its arguments. */
  command: z.string(),
  startedAt: z.string(),
  /** Connections following it now. */
  attached: z.number().int().nonnegative(),
  cols: z.number().int(),
  rows: z.number().int(),
  /** `null` while the process runs. */
  exitCode: z.number().int().nullable(),
  /** The launch of a "Claude aqui" terminal, which the session in the central also carries. */
  launchId: z.string().nullable(),
});
export type TerminalInfo = z.infer<typeof TerminalInfo>;

export const TerminalAttachResult = z.object({
  terminalId: z.string(),
  /** base64 of the output the terminal kept (at most 2 MB): where to continue from. */
  scrollback: z.string(),
  cols: z.number().int(),
  rows: z.number().int(),
  exitCode: z.number().int().nullable(),
});
export type TerminalAttachResult = z.infer<typeof TerminalAttachResult>;

/** Whether the host's terminals are on, how many at most and which shell they open. */
export const TerminalSettings = z.object({
  enabled: z.boolean(),
  max: z.number().int(),
  /** The program of the default shell. */
  shell: z.string(),
});
export type TerminalSettings = z.infer<typeof TerminalSettings>;

/** How a ssh destino authenticates: the host's agent, a key file, a vault key or a password. */
export const SshAuth = z.enum(["agent", "key-file", "vault-key", "password"]);
export type SshAuth = z.infer<typeof SshAuth>;

/** The short, fixed list of OpenSSH options a destino may set. */
export const SshOptions = z
  .object({
    serverAliveInterval: z.number().int().optional(),
    compression: z.boolean().optional(),
    /** `[bind:]port:host:port`, kept as text. */
    localForward: z.array(z.string()).optional(),
    /** Off by default; turning it on asks for `confirm`. */
    forwardAgent: z.boolean().optional(),
  })
  .strict();
export type SshOptions = z.infer<typeof SshOptions>;

/** A ssh destino: only a reference to its secret, never the secret. */
export const SshTarget = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  /** The Flightdeck host that opens the connection; `null` is the local one. */
  viaHost: z.string().nullable(),
  auth: SshAuth,
  /** `key-file`: the path on the host; `vault-key` and `password`: the item of the vault. */
  secretRef: z.string().nullable(),
  /** The destino this one goes through (ProxyJump). */
  jump: z.string().nullable(),
  options: SshOptions,
  tags: z.array(z.string()),
  /** The fingerprint (SHA256) of the pinned server key; `null` before the first confirmation. */
  hostKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SshTarget = z.infer<typeof SshTarget>;

/** One name of `~/.ssh/config` the import would turn into a destino. */
export const SshImportEntry = z.object({
  alias: z.string(),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  identityFile: z.string().nullable(),
  proxyJump: z.string().nullable(),
  /** A destino with this name, or with the same host, port and user, is already registered. */
  exists: z.boolean(),
});
export type SshImportEntry = z.infer<typeof SshImportEntry>;

export const SshImportResult = z.object({
  created: z.array(SshTarget),
  skipped: z.array(z.object({ alias: z.string(), reason: z.string() })),
});
export type SshImportResult = z.infer<typeof SshImportResult>;

/**
 * What `ssh.hostkey.check` found: `unknown` (first connection: confirm the fingerprint),
 * `pinned` (the key is the one kept) or `changed` (blocked: `pinned` is the old fingerprint).
 */
export const SshHostKeyCheck = z.object({
  status: z.enum(["unknown", "pinned", "changed"]),
  /** The SHA256 fingerprint the server shows now. */
  fingerprint: z.string(),
  /** The fingerprint kept for this destino, `null` before the first confirmation. */
  pinned: z.string().nullable(),
});
export type SshHostKeyCheck = z.infer<typeof SshHostKeyCheck>;

/** The answer to `ssh.test`: reachable and logged in, or why not (in words, not the raw ssh error). */
export const SshTestResult = z.object({ ok: z.boolean(), error: z.string().nullable() });
export type SshTestResult = z.infer<typeof SshTestResult>;

/** A password or key passphrase that ssh is asking for; the app answers with `askpass.answer`. */
export const AskpassRequest = z.object({
  type: z.literal("askpass.request"),
  requestId: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  kind: z.enum(["password", "passphrase"]),
  /** Where the vault keeps it, to be read without asking the person. */
  secretRef: z.string().nullable(),
  /** What ssh printed, such as "deploy@host's password:". */
  prompt: z.string(),
});
export type AskpassRequest = z.infer<typeof AskpassRequest>;

/** How a snippet variable is filled in: a default value and a short list of options. */
export const SnippetVar = z
  .object({
    default: z.string().max(1000).optional(),
    options: z.array(z.string().max(200)).optional(),
  })
  .strict();
export type SnippetVar = z.infer<typeof SnippetVar>;

/**
 * What the form sends for a snippet (phase 18): a `command` (`run`, one line) or a `prompt`
 * (`text`), with `{{name}}` variables. A snippet carries no secret.
 */
export const SnippetInput = z
  .object({
    name: z.string(),
    type: z.enum(["command", "prompt"]),
    run: z.string().optional(),
    text: z.string().optional(),
    vars: z.record(z.string(), SnippetVar).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();
export type SnippetInput = z.infer<typeof SnippetInput>;

/** A field to fill in when a snippet is used. The specials (`cwd`, `branch`, `file`, `selection`) come from the context. */
export const SnippetField = z.object({
  name: z.string(),
  special: z.boolean(),
  default: z.string().nullable(),
  options: z.array(z.string()),
});
export type SnippetField = z.infer<typeof SnippetField>;

export const SnippetScope = z.enum(["host", "project"]);

/** A snippet of this host, from the daemon or from a project's versioned file. */
export const Snippet = z.object({
  /** A ULID for the ones in the daemon; `file:<project>:<name>` for the ones in the file. */
  id: z.string(),
  scope: SnippetScope,
  source: z.enum(["daemon", "file"]),
  projectPath: z.string().nullable(),
  name: z.string(),
  type: z.enum(["command", "prompt"]),
  run: z.string().nullable(),
  text: z.string().nullable(),
  vars: z.record(z.string(), SnippetVar),
  tags: z.array(z.string()),
  fields: z.array(SnippetField),
  favorite: z.boolean(),
  uses: z.number().int(),
  lastUsedAt: z.string().nullable(),
  /** A command from the versioned file runs only when the file is trusted; pasting never needs it. */
  runnable: z.boolean(),
});
export type Snippet = z.infer<typeof Snippet>;

/** The project's versioned `.flightdeck/snippets.yaml`: its hash, whether it is trusted and what was left out. */
export const SnippetFileInfo = z.object({
  path: z.string(),
  hash: z.string(),
  trusted: z.boolean(),
  errors: z.array(z.string()),
});
export type SnippetFileInfo = z.infer<typeof SnippetFileInfo>;

/** A line of the shell history that could become a snippet; a flagged one has no `command` until revealed and is never `selectable`. */
export const SnippetHistoryCandidate = z.object({
  /** Stable for the same command, so the app can say which ones to import. */
  id: z.string(),
  command: z.string().nullable(),
  count: z.number().int(),
  shells: z.array(z.string()),
  /** What the secret scan found (the kinds, never the values). */
  flagged: z.array(z.string()),
  hidden: z.boolean(),
  selectable: z.boolean(),
});
export type SnippetHistoryCandidate = z.infer<typeof SnippetHistoryCandidate>;

export const SnippetHistoryResult = z.object({
  candidates: z.array(SnippetHistoryCandidate),
  sources: z.array(z.object({ shell: z.string(), found: z.boolean() })),
  created: z.array(Snippet),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type SnippetHistoryResult = z.infer<typeof SnippetHistoryResult>;

const SnippetValues = z.record(z.string().max(100), z.string().max(4000));
const SnippetUseContext = z
  .object({
    cwd: z.string().optional(),
    file: z.string().max(4000).optional(),
    selection: z.string().max(20_000).optional(),
  })
  .strict();

/** A persona of this host: where it lives, the hash of a versioned file and whether it is trusted. */
export const Persona = PersonaFields.extend({
  scope: z.enum(["pack", "host", "project"]),
  /** The SHA-256 of the project's file; `null` for the others. */
  hash: z.string().nullable(),
  /** A project persona is trusted once its hash is; the others always are. */
  trusted: z.boolean(),
  /** A pack persona the host has edited. */
  modified: z.boolean(),
});
export type Persona = z.infer<typeof Persona>;

/** A persona as a subagent: what the SDK's `agents` and claude's `--agents` take. */
export const PersonaAgent = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
});
export type PersonaAgent = z.infer<typeof PersonaAgent>;

/** The agents `persona-<id>` of a project, and the versioned personas left out for lack of trust. */
export const PersonaSubagents = z.object({
  agents: z.record(z.string(), PersonaAgent),
  untrusted: z.array(z.string()),
});
export type PersonaSubagents = z.infer<typeof PersonaSubagents>;

/** What applying or leaving a persona answers: the persona and the message that was sent. */
export const PersonaSwitchResult = z.object({ persona: SessionPersona, text: z.string() });
export type PersonaSwitchResult = z.infer<typeof PersonaSwitchResult>;

/** A persona ready to use, with where it came from. */
export const ResolvedPersonaResult = z.object({
  persona: PersonaFields,
  source: z.enum(["project", "host", "pack", "inline"]),
  /** The hash of the versioned file, for the ones from a project. */
  hash: z.string().nullable(),
});
export type ResolvedPersonaResult = z.infer<typeof ResolvedPersonaResult>;

/** The project's `.flightdeck/personas` folder and the files in it that were left out. */
export const PersonaProjectInfo = z.object({ path: z.string(), errors: z.array(z.string()) });
export type PersonaProjectInfo = z.infer<typeof PersonaProjectInfo>;

const TerminalId = z.string().min(1);
const TerminalCols = z.number().int().min(1).max(500);
const TerminalRows = z.number().int().min(1).max(300);

const ReviewSide = z.enum(["new", "old"]);

/** A file a session wrote (Write, Edit, MultiEdit, NotebookEdit; Bash does not count). */
export const SessionFile = z.object({
  path: z.string(),
  edits: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
});
export type SessionFile = z.infer<typeof SessionFile>;

export const FileSession = z.object({
  claudeSessionId: z.string(),
  edits: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
  title: z.string().nullable(),
});
export type FileSession = z.infer<typeof FileSession>;

/** A review comment of a card's PR, read from GitHub or Azure DevOps; nothing is posted back. */
export const PrComment = z.object({
  id: z.string(),
  /** `null` for a review's summary, about the whole PR. */
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  author: z.string(),
  /**
   * GitHub's `author_association` (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE…), as the API
   * says it; `null` on Azure DevOps. The automations ignore comments from outside the team.
   */
  authorAssociation: z.string().nullable().default(null),
  /** Azure DevOps' identity of the author (`uniqueName`, else the id); `null` on GitHub. */
  authorIdentity: z.string().nullable().default(null),
  body: z.string(),
  resolved: z.boolean(),
  kind: z.enum(["inline", "review"]),
});
export type PrComment = z.infer<typeof PrComment>;

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
});
export type ReviewComment = z.infer<typeof ReviewComment>;

export const ReviewSent = z.object({
  /** `copy`: the session takes no messages, the app hands `text` over. */
  via: z.enum(["session", "card", "terminal", "copy"]),
  text: z.string(),
  comments: z.number().int(),
});
export type ReviewSent = z.infer<typeof ReviewSent>;

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

// Phase 8 (track A): estimated costs, read from the transcripts of every session of the host.
export const UnpricedModel = z.object({
  model: z.string(),
  entries: z.number().int(),
  tokens: z.number().int(),
});
export type UnpricedModel = z.infer<typeof UnpricedModel>;

/** A managed session whose computed cost is far from the SDK's `total_cost_usd`. */
export const CostsDivergence = z.object({
  claudeSessionId: z.string(),
  /** The model with most of the session's cost. */
  model: z.string(),
  computedUsd: z.number(),
  sdkUsd: z.number(),
});
export type CostsDivergence = z.infer<typeof CostsDivergence>;

/** Where the usage of a message came from; `subagent` keeps the parent session's id. */
/** `auto-approve` (phase 13): the automatic approval's own queries. */
export const UsageOrigin = z.enum([
  "terminal",
  "app",
  "card",
  "workflow",
  "subagent",
  "auto-approve",
]);
export type UsageOrigin = z.infer<typeof UsageOrigin>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dia em AAAA-MM-DD");

/** Days `from`..`to` (inclusive, host time zone) and optional filters. */
export const CostsFilter = z.object({
  from: Day,
  to: Day,
  projectKey: z.string().optional(),
  model: z.string().optional(),
  origin: UsageOrigin.optional(),
});
export type CostsFilter = z.infer<typeof CostsFilter>;

export const TokenCounts = z.object({
  input: z.number().int(),
  output: z.number().int(),
  cacheRead: z.number().int(),
  cacheWrite5m: z.number().int(),
  cacheWrite1h: z.number().int(),
});
export type TokenCounts = z.infer<typeof TokenCounts>;

export const CostsSummary = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    /** Estimated, in API prices; messages of a model without a price count 0. */
    costUsd: z.number(),
    tokens: TokenCounts,
    /** What the cache reads cost less than the same tokens as plain input. */
    cacheSavingsUsd: z.number(),
    messages: z.number().int(),
    unpricedMessages: z.number().int(),
  }),
  /** By day, then project: the chart stacks the projects of each day. */
  byDay: z.array(
    z.object({ day: z.string(), projectKey: z.string(), costUsd: z.number(), tokens: z.number() }),
  ),
  byProject: z.array(z.object({ projectKey: z.string(), costUsd: z.number(), tokens: z.number() })),
  byModel: z.array(
    z.object({
      model: z.string(),
      costUsd: z.number(),
      tokens: z.number(),
      /** `false` for a model without a price: its tokens count, its cost does not. */
      priced: z.boolean(),
    }),
  ),
  byOrigin: z.array(z.object({ origin: UsageOrigin, costUsd: z.number(), tokens: z.number() })),
  /** By the persona the session opened with (else the one applied); `null` is no persona. */
  byPersona: z.array(
    z.object({ persona: z.string().nullable(), costUsd: z.number(), tokens: z.number() }),
  ),
  /** The 20 most expensive sessions, subagents included. */
  topSessions: z.array(
    z.object({
      claudeSessionId: z.string(),
      /** The managed session, when the app or a card ran it (opens it live). */
      sessionId: z.string().nullable(),
      projectKey: z.string(),
      title: z.string().nullable(),
      cwd: z.string().nullable(),
      costUsd: z.number(),
      tokens: z.number(),
    }),
  ),
});
export type CostsSummary = z.infer<typeof CostsSummary>;

export const CostsSession = z.object({
  claudeSessionId: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
  /** The part of `costUsd` spent by the session's subagents. */
  subagentCostUsd: z.number(),
  byModel: z.array(z.object({ model: z.string(), costUsd: z.number(), tokens: z.number() })),
});
export type CostsSession = z.infer<typeof CostsSession>;

/** The readings of one quota window over the last hours, with where it is heading. */
export const QuotaHistory = z.object({
  window: z.string(),
  hours: z.number().int(),
  samples: z.array(
    z.object({
      utilization: z.number().nullable(),
      status: z.string(),
      resetsAt: z.string().nullable(),
      takenAt: z.string(),
    }),
  ),
  /** From 3 samples of the current window on (a linear fit); `null` before that. */
  projection: z
    .object({
      /** When the window reaches 100% at the current pace; `null` when not before it resets. */
      exhaustsAt: z.string().nullable(),
      resetsAt: z.string().nullable(),
      samples: z.number().int(),
    })
    .nullable(),
  /**
   * The 5-hour window only: each project's share of the estimated cost of the entries since the
   * window began (an approximation: the plan does not say who used it).
   */
  consumers: z.array(z.object({ projectKey: z.string(), costUsd: z.number(), share: z.number() })),
});
export type QuotaHistory = z.infer<typeof QuotaHistory>;

/** A cost limit of the host or of one project, per day or month (host time zone). */
export const BudgetInput = z.object({
  /** Present to change an existing budget. */
  id: z.string().optional(),
  scope: z.enum(["host", "project"]),
  /** Required for `project`, ignored for `host`. */
  projectKey: z.string().min(1).optional(),
  period: z.enum(["day", "month"]),
  limitUsd: z.number().positive(),
  /** `queue`: at 100%, new cards of the scope wait (sessions are never held). */
  action: z.enum(["notify", "queue"]),
});
export type BudgetInput = z.infer<typeof BudgetInput>;

export const Budget = z.object({
  id: z.string(),
  scope: z.enum(["host", "project"]),
  projectKey: z.string().nullable(),
  period: z.enum(["day", "month"]),
  limitUsd: z.number(),
  action: z.enum(["notify", "queue"]),
  createdAt: z.string(),
  /** The current period: `YYYY-MM-DD` or `YYYY-MM`. */
  periodKey: z.string(),
  spentUsd: z.number(),
  /** `spentUsd / limitUsd`. */
  fraction: z.number(),
  /** Thresholds (0.5, 0.8, 1) already crossed in this period. */
  crossed: z.array(z.number()),
});
export type Budget = z.infer<typeof Budget>;

export const CostsStatus = z.object({
  /** The first pass over the transcripts that already existed. */
  initialLoad: z.object({
    state: z.enum(["running", "done"]),
    filesDone: z.number().int(),
    filesTotal: z.number().int(),
  }),
  /** When the default price table was taken (`YYYY-MM-DD`). */
  pricingDate: z.string(),
  /** Models without a price: their tokens count, their cost does not. */
  unpriced: z.array(UnpricedModel),
  /** Over 10% and US$ 0.05 apart: the price table may be out of date. */
  divergences: z.array(CostsDivergence),
});
export type CostsStatus = z.infer<typeof CostsStatus>;

const ProjectFields = {
  name: z.string().min(1).optional(),
  baseBranch: z.string().min(1).optional(),
  prProvider: PrProviderKind.optional(),
  /** `null` or blank removes the script. */
  setupScript: z.string().nullable().optional(),
  promptTemplate: z.string().optional(),
  /** Phase 13: fields left out keep their value. */
  autoApprove: AutoApproveSettings.partial().optional(),
  /** `null` removes the integration. */
  issues: IssuesConfig.nullable().optional(),
};

export const ProjectAddPayload = z.object({ path: z.string().min(1), ...ProjectFields });
export const ProjectUpdatePayload = z.object({
  projectId: z.string(),
  ...ProjectFields,
  /** The default persona by column; `null` removes the one of a column. */
  personaByColumn: z.partialRecord(BoardColumn, z.string().nullable()).optional(),
  personaSubagents: PersonaSubagentsMode.optional(),
});
export const CardIdPayload = z.object({ cardId: z.string() });
/** Phase 6: with `workflow`, the card runs that trusted workflow with `inputs`. */
export const CardStartPayload = z.object({
  cardId: z.string(),
  workflow: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  /** Opens the card's session in that persona, over the column's default (phase 20). */
  persona: PersonaRef.optional(),
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
  /** The persona applied to it, else the one it was opened with (phase 20). */
  persona: SessionPersona.optional(),
  meta: SessionMeta.optional(),
  summary: SessionLine.optional(),
});
export type ExternalSession = z.infer<typeof ExternalSession>;

/** Phase 12: an MCP server as `.mcp.json` holds it. */
export const McpServerInput = z.object({
  name: z.string().min(1),
  type: z.enum(["stdio", "http", "sse"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/** An MCP server that applies to a project, secrets masked. */
export const McpServerView = McpServerInput.extend({
  origin: z.enum(["project", "user", "user-project"]),
  readOnly: z.boolean(),
  transport: z.enum(["stdio", "http", "sse"]),
  enabled: z.boolean(),
});
export type McpServerView = z.infer<typeof McpServerView>;

/** Phase 12: the live state of one MCP server of a managed session. */
export const McpLiveStatus = z.object({
  name: z.string(),
  status: z.enum(["connected", "failed", "needs-auth", "pending", "disabled"]),
  error: z.string().optional(),
});
export type McpLiveStatus = z.infer<typeof McpLiveStatus>;

/** Phase 12: what `agentcfg.*` edits. */
export const AgentCfgKind = z.enum(["claudemd", "agent", "skill"]);
const AgentCfgOrigin = z.enum(["project", "user"]);

/** A CLAUDE.md, agent or skill; the user's (~/.claude) are read-only. */
export const AgentCfgItem = z.object({
  kind: AgentCfgKind,
  /** Relative to the project, or to ~/.claude for the user's. */
  path: z.string(),
  origin: AgentCfgOrigin,
  readOnly: z.boolean(),
  /** sha256 of the file's bytes, to send back as `expectedHash`. */
  hash: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});
export type AgentCfgItem = z.infer<typeof AgentCfgItem>;

/** Phase 16: who asks for a secret. `you` is only for uses the app itself started. */
export const VaultRequester = z.enum(["you", "claude", "automation", "workflow"]);
export type VaultRequester = z.infer<typeof VaultRequester>;

/** Phase 16: who a daemon can be asking for; never `you`. */
export const VaultDaemonRequester = z.enum(["claude", "automation", "workflow"]);
export type VaultDaemonRequester = z.infer<typeof VaultDaemonRequester>;

// ---------------------------------------------------------------------------
// Phase 21: messages between sessions, and teams
// ---------------------------------------------------------------------------

/** Who sends: a managed session by its id, or a terminal session by its launch id. */
export const SessionIdentity = z
  .object({ session: z.string().min(1).optional(), launch: z.string().min(1).optional() })
  .refine((who) => (who.session === undefined) !== (who.launch === undefined), {
    message: "informe a sessão (session) ou o lançamento (launch), um dos dois",
  });
export type SessionIdentity = z.infer<typeof SessionIdentity>;

export const MessageStatus = z.enum(["pending", "delivered", "queued", "refused", "expired"]);
export type MessageStatus = z.infer<typeof MessageStatus>;
/** `session` is from another session; `system` and `idle` are from Flightdeck itself. */
export const MessageKind = z.enum(["session", "system", "idle"]);
export type MessageKind = z.infer<typeof MessageKind>;

export const MessageInfo = z.object({
  id: z.string(),
  fromSession: z.string(),
  fromHost: z.string(),
  toSession: z.string(),
  toHost: z.string(),
  text: z.string(),
  status: MessageStatus,
  reason: z.string().nullable(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
  teamId: z.string().nullable(),
  kind: MessageKind,
});
export type MessageInfo = z.infer<typeof MessageInfo>;

export const MessagingState = z.enum(["running", "waiting", "idle", "ended"]);
export const MessagingKind = z.enum(["managed", "card", "terminal", "plain"]);

/** A session as another session sees it in `list_sessions`. */
export const MessagingSession = z.object({
  /** `<host>/<id>`: what `send_to_session` takes. */
  address: z.string(),
  id: z.string(),
  host: z.string(),
  name: z.string().nullable(),
  /** The standard alias (`project-persona-number`) that addresses it; null when it has none. */
  alias: z.string().nullable(),
  /** Every alias that points at it, the old ones of a rename included. */
  aliases: z.array(z.string()),
  persona: z.string().nullable(),
  state: MessagingState,
  projectKey: z.string().nullable(),
  teamId: z.string().nullable(),
  kind: MessagingKind,
  /** Whether it takes messages; `reason` says why not (a plain claude has no channel). */
  receives: z.boolean(),
  reason: z.string().nullable(),
});
export type MessagingSession = z.infer<typeof MessagingSession>;

/** A session as the daemon of another host is told about it. */
export const MessagingPeer = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  alias: z.string().nullable().default(null),
  aliases: z.array(z.string()).default([]),
  persona: z.string().nullable(),
  projectKey: z.string().nullable(),
  teamId: z.string().nullable(),
  state: MessagingState,
  kind: MessagingKind,
  receives: z.boolean(),
  reason: z.string().nullable(),
});
export type MessagingPeer = z.infer<typeof MessagingPeer>;

export const SendResult = z.object({
  id: z.string(),
  status: z.enum(["delivered", "queued", "refused"]),
  reason: z.string().nullable(),
});
export type SendResult = z.infer<typeof SendResult>;

/** A message on its way between hosts, through the app. */
export const RelayMessage = z.object({
  id: z.string(),
  from: z.object({
    id: z.string(),
    host: z.string(),
    name: z.string().nullable(),
    persona: z.string().nullable(),
    projectKey: z.string().nullable(),
    teamId: z.string().nullable(),
  }),
  toSession: z.string(),
  toHost: z.string(),
  text: z.string(),
  createdAt: z.string(),
  /** The sender carries third-party content (phase 13); the destination suspends its auto-approval. */
  untrusted: z.boolean(),
  kind: MessageKind.default("session"),
});
export type RelayMessage = z.infer<typeof RelayMessage>;

export const TeamState = z.enum(["active", "paused", "closed"]);
export type TeamState = z.infer<typeof TeamState>;

/** A member of a team: the coordinator or a worker with a card of its own. */
export const TeamMember = z.object({
  name: z.string(),
  role: z.enum(["coordinator", "worker"]),
  persona: z.string().nullable(),
  cardId: z.string().nullable(),
  /** Null while a worker's card waits in the quota queue and has no session yet. */
  sessionId: z.string().nullable(),
  address: z.string().nullable(),
  sessionState: MessagingState.nullable(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamInfo = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  goal: z.string(),
  coordinator: z.string().nullable(),
  members: z.array(TeamMember),
  /** The commands the coordinator runs to check a worker's work (the project's checks if empty). */
  checks: z.array(z.string()),
  state: TeamState,
  /** Who paused it: you, or the plan quota (which also resumes it). */
  pausedBy: z.enum(["user", "quota"]).nullable(),
  instructionsVersion: z.string(),
  createdAt: z.string(),
});
export type TeamInfo = z.infer<typeof TeamInfo>;

export const TeamStatus = z.object({
  team: TeamInfo,
  members: z.array(
    TeamMember.extend({
      /** The last message this member sent inside the team. */
      lastReport: z.object({ text: z.string(), at: z.string() }).nullable(),
      sent: z.number().int(),
      received: z.number().int(),
    }),
  ),
  messages: z.number().int(),
});
export type TeamStatus = z.infer<typeof TeamStatus>;

export const TeamsUpdatedFrame = z.object({
  type: z.literal("teams.updated"),
  team: TeamInfo,
  /** Why it changed, when that is news for you (quota pause, quota resume). */
  reason: z.string().nullable(),
});
export type TeamsUpdatedFrame = z.infer<typeof TeamsUpdatedFrame>;

/** Phase 17: how an action asks for approval. */
export const ActionApproval = z.enum(["always", "never", "first-per-session"]);

/** Phase 17: a declared action, as the app lists it (no secret values: only which ids it uses). */
export const ActionInfo = z.object({
  name: z.string(),
  description: z.string(),
  /** `app` was made in the app; `versioned` comes from .flightdeck/actions.yaml. */
  source: z.enum(["app", "versioned"]),
  projectId: z.string().nullable(),
  host: z.string().nullable(),
  ssh: z.string().nullable(),
  run: z.array(z.string()),
  cwd: z.string().nullable(),
  env: z.record(z.string(), z.string()),
  params: z.record(z.string(), z.object({ pattern: z.string(), default: z.string().nullable() })),
  timeoutS: z.number().int(),
  /** The effective mode: the declared one, or the default for its kind. */
  approval: ActionApproval,
  /** Labels such as prod, from the action. */
  tags: z.array(z.string()),
  secrets: z.object({ values: z.array(z.string()), files: z.array(z.string()) }),
  trusted: z.boolean(),
  /** What differs from what was trusted: "declaração" and/or file paths. */
  changed: z.array(z.string()),
  /** What to pass to `actions.trust` to trust this declaration as it is. */
  hash: z.string(),
});
export type ActionInfo = z.infer<typeof ActionInfo>;

/** Phase 17: one run of an action; the output is masked. */
export const ActionRunInfo = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  requestedBy: VaultRequester,
  startedAt: z.string(),
  durationMs: z.number().int(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  output: z.string(),
});
export type ActionRunInfo = z.infer<typeof ActionRunInfo>;

/** The actions of a scope, and what is wrong with the versioned file (the valid ones still load). */
export const ActionList = z.object({ actions: z.array(ActionInfo), errors: z.array(z.string()) });
export type ActionList = z.infer<typeof ActionList>;

export const ActionResult = z.object({
  runId: z.string(),
  exitCode: z.number().int(),
  output: z.string(),
  durationMs: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
});
export type ActionResult = z.infer<typeof ActionResult>;

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
  /** Phase 9: downloads, verifies and applies the checked update; only with `confirm: true`. */
  cmd("daemon.update.apply", z.object({ confirm: z.boolean().optional() })),
  /** Phase 12: the git snapshots of a Claude session, oldest first. */
  cmd("snapshots.list", z.object({ claudeSessionId: z.string().min(1) })),
  /** Phase 12: the files turn `n` (a `before` snapshot's n) changed, between its trees. */
  cmd("snapshots.files", z.object({ claudeSessionId: z.string().min(1), n: z.number().int() })),
  /** Phase 12: what going back to before turn `turn` (a `before` snapshot's n) changes. */
  cmd("rewind.preview", z.object({ claudeSessionId: z.string().min(1), turn: z.number().int() })),
  cmd(
    "rewind.apply",
    z.object({
      claudeSessionId: z.string().min(1),
      turn: z.number().int(),
      confirm: z.boolean().optional(),
    }),
  ),
  cmd(
    "rewind.undo",
    z.object({ claudeSessionId: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  /** Phase 12: a new Claude session up to a message, opened in the app or in the terminal. */
  cmd(
    "session.fork",
    z.object({
      claudeSessionId: z.string().min(1),
      cwd: z.string().min(1),
      upToMessageId: z.string().optional(),
      open: z.enum(["flightdeck", "terminal"]),
      rewindTurn: z.number().int().optional(),
    }),
  ),
  /** Phase 12: the project's MCP servers; writes only to its .mcp.json and settings.local.json. */
  cmd("mcp.list", z.object({ projectId: z.string() })),
  /** Without confirm, only the exact command (or URL) that would run. */
  cmd(
    "mcp.test",
    z.object({ projectId: z.string(), name: z.string(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.save",
    z.object({ projectId: z.string(), server: McpServerInput, confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.remove",
    z.object({ projectId: z.string(), name: z.string(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "mcp.toggle",
    z.object({
      projectId: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      confirm: z.boolean().optional(),
      /** A live managed session to switch right away too. */
      sessionId: z.string().optional(),
    }),
  ),
  /** Phase 12: the MCP servers of a live managed session, as its runtime reports them. */
  cmd("mcp.status", z.object({ sessionId: z.string() })),
  /** Phase 12: the project's CLAUDE.md files, agents and skills; writes only inside the project. */
  cmd("agentcfg.list", z.object({ projectId: z.string(), kind: AgentCfgKind })),
  /** Phase 17: the actions of a project (and of the host) and their runs. */
  cmd("actions.list", z.object({ projectId: z.string().optional() })),
  /** `secretIds` is what the app has, so a reference to another secret is an error. */
  cmd(
    "actions.save",
    z.object({
      projectId: z.string().optional(),
      definition: z.record(z.string(), z.unknown()),
      secretIds: z.array(z.string()).optional(),
    }),
  ),
  cmd("actions.remove", z.object({ projectId: z.string().optional(), name: z.string().min(1) })),
  /** Versioned actions run only once trusted, by the hash `actions.list` shows. */
  cmd(
    "actions.trust",
    z.object({
      projectId: z.string().optional(),
      name: z.string().min(1),
      hash: z.string().min(1),
    }),
  ),
  cmd(
    "actions.run",
    z.object({
      projectId: z.string().optional(),
      name: z.string().min(1),
      params: z.record(z.string(), z.string()).optional(),
      requestedBy: VaultRequester,
      /** The Claude Code session asking; the once-per-session approvals hold for it. */
      session: z.string().min(1).optional(),
    }),
  ),
  /** A command written by Claude with secrets in its environment; the app always approves it. */
  cmd(
    "actions.runFree",
    z.object({
      command: z.string().min(1).max(4000),
      secrets: z.array(z.string().min(1)).min(1).max(8),
      host: z.string().optional(),
      requestedBy: VaultDaemonRequester,
      session: z.string().min(1).optional(),
    }),
  ),
  cmd(
    "actions.runs",
    z.object({
      projectId: z.string().optional(),
      name: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  ),
  /** Receive the daemon's `vault.request` and `vault.used` frames (the app does). */
  cmd("vault.watch", z.object({}).strict()),
  /** The user refused a `vault.request`: the run that waits for it fails at once. */
  cmd("vault.deny", z.object({ requestId: z.string().min(1) })),
  /** Phase 21: messages between sessions. `as` is who sends: a managed session, or a terminal launch. */
  cmd(
    "messages.send",
    z.object({ as: SessionIdentity, to: z.string().min(1), text: z.string().min(1) }),
  ),
  cmd(
    "messages.list",
    z.object({
      team: z.string().optional(),
      session: z.string().optional(),
      host: z.string().optional(),
      status: MessageStatus.optional(),
      days: z.number().int().min(1).max(365).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  ),
  /** The sessions `as` may see by the rules (every host the app described). */
  cmd("messages.sessions", z.object({ as: SessionIdentity })),
  cmd(
    "messages.read",
    z.object({
      as: SessionIdentity,
      session: z.string().min(1),
      last: z.number().int().min(1).max(20).optional(),
    }),
  ),
  /** The app hands over a message from another host's daemon; idempotent by id. */
  cmd("messages.relay", z.object({ message: RelayMessage })),
  /** The app tells how a relayed message ended at the recipient's daemon. */
  cmd(
    "messages.relayed",
    z.object({
      id: z.string().min(1),
      status: z.enum(["delivered", "queued", "refused"]),
      reason: z.string().nullable().optional(),
    }),
  ),
  /** This host's sessions as the app hands them to the other daemons (`messages.peers`). */
  cmd("messages.directory", z.object({}).strict()),
  /** The app describes the sessions of another host (what `list_sessions` shows of it). */
  cmd(
    "messages.peers",
    z.object({
      host: z.string().min(1),
      sessions: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().nullable(),
          persona: z.string().nullable(),
          projectKey: z.string().nullable(),
          teamId: z.string().nullable(),
          state: MessagingState,
          kind: MessagingKind,
          receives: z.boolean(),
          reason: z.string().nullable(),
        }),
      ),
    }),
  ),
  /** Receive `messages.updated`, `messages.relay`, `messaging.alert` and `idle.fired`. */
  cmd("messages.watch", z.object({}).strict()),
  cmd("idle.subscribe", z.object({ as: SessionIdentity, session: z.string().min(1) })),
  cmd("messaging.rules.get", z.object({}).strict()),
  /** Replaces the policy (exceptions and limits); `unpause` frees pairs a loop paused. */
  cmd(
    "messaging.rules.set",
    z.object({
      policy: z.record(z.string(), z.unknown()),
      unpause: z.array(z.string()).optional(),
    }),
  ),
  /** Phase 21: teams, a coordinator and workers with cards of their own. */
  cmd("teams.list", z.object({ projectId: z.string().optional() })),
  cmd(
    "teams.create",
    z.object({
      projectId: z.string().min(1),
      goal: z.string().min(1).max(8000),
      name: z.string().min(1).max(80).optional(),
      workers: z.number().int().min(1).max(8),
      coordinatorPersona: z.string().min(1).optional(),
      workerPersonas: z.array(z.string().min(1)).max(8).optional(),
      checks: z.array(z.string().min(1).max(400)).max(10).optional(),
    }),
  ),
  /** Changes the goal or the checks, a member's persona, adds workers or takes a member out. */
  cmd(
    "teams.update",
    z.object({
      team: z.string().min(1),
      goal: z.string().min(1).max(8000).optional(),
      checks: z.array(z.string().min(1).max(400)).max(10).optional(),
      persona: z
        .object({ member: z.string().min(1), persona: z.string().min(1).nullable() })
        .optional(),
      addWorkers: z.number().int().min(1).max(8).optional(),
      removeMember: z.string().min(1).optional(),
    }),
  ),
  cmd("teams.pause", z.object({ team: z.string().min(1) })),
  cmd("teams.resume", z.object({ team: z.string().min(1) })),
  cmd("teams.close", z.object({ team: z.string().min(1), confirm: z.boolean().optional() })),
  /** A message from Flightdeck to every member ("mandar a todos"). */
  cmd("teams.message", z.object({ team: z.string().min(1), text: z.string().min(1) })),
  /** With `as`, only a member of the team may ask (the MCP tool does). */
  cmd("teams.status", z.object({ team: z.string().min(1), as: SessionIdentity.optional() })),
  cmd("teams.watch", z.object({}).strict()),
  /** Phase 19: the rules of one secret, replaced whole (the ones that break the ceiling are refused). */
  cmd(
    "vault.rules.set",
    z.object({
      secretId: z.string().min(1),
      tags: z.array(z.string().min(1)).max(16).optional(),
      rules: z.array(z.unknown()).max(200),
    }),
  ),
  cmd("vault.rules.get", z.object({ secretId: z.string().min(1) })),
  /** "What happens if…": the verdict for a use, without recording or spending anything. */
  cmd(
    "vault.rules.preview",
    z.object({
      secretId: z.string().min(1),
      requester: VaultRequester,
      purpose: z.enum(["ssh", "action", "run_with_secret"]),
      action: z.string().optional(),
      host: z.string().optional(),
      tags: z.array(z.string()).optional(),
      project: z.string().optional(),
      session: z.string().optional(),
      risk: z.enum(["low", "medium", "high"]).optional(),
      actionApproval: ActionApproval.optional(),
      at: z.number().optional(),
    }),
  ),
  /** The user approved a request that asked; `vault.deliver` for it only works after this. */
  cmd(
    "vault.approve",
    z.object({
      requestId: z.string().min(1),
      via: z.enum(["app", "tray"]),
      /** How long the Approve button was held, for the requests that need 2 s. */
      heldMs: z.number().int().min(0).optional(),
      scope: z.enum(["once", "session"]).optional(),
    }),
  ),
  cmd(
    "vault.decisions",
    z.object({
      secretId: z.string().min(1).optional(),
      days: z.number().int().min(1).max(365).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  ),
  /** Uses by secret, requester and outcome; `csv` adds the same as a CSV text. */
  cmd(
    "vault.report",
    z.object({
      days: z.number().int().min(1).max(365).optional(),
      format: z.enum(["json", "csv"]).optional(),
    }),
  ),
  /**
   * Phase 16: the app hands the daemon a secret for one use. The daemon keeps it in memory only,
   * for at most 60 s (or until `expiresAt`, in milliseconds since the epoch), and only accepts it
   * from loopback or Tailscale.
   */
  cmd(
    "vault.deliver",
    z.object({
      secretId: z.string().min(1).max(200),
      value: z.string().min(1).max(65_536),
      purpose: z.string().min(1).max(100),
      expiresAt: z.number().int(),
      requester: VaultRequester.default("you"),
    }),
  ),
  /** Phase 16: runs a daemon action with a delivered secret, which is then discarded. */
  cmd(
    "vault.use",
    z.object({
      secretId: z.string().min(1).max(200),
      purpose: z.string().min(1).max(100),
      action: z.string().min(1).max(100),
    }),
  ),
  /** Phase 13: the same request in 2 to 4 variants, each in its own worktree. */
  cmd(
    "card.startArena",
    z.object({
      cardId: z.string(),
      variants: z
        .array(
          z.object({
            model: z.string().min(1).optional(),
            effort: EffortLevel.optional(),
            /** Phase 20: the persona the variant's session opens in. */
            persona: PersonaRef.optional(),
          }),
        )
        .min(2)
        .max(4),
      workflow: z.string().min(1).optional(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
  ),
  cmd("card.arena", z.object({ cardId: z.string() })),
  /** The variant becomes the card's worktree; the others are stopped and removed (`confirm`). */
  cmd(
    "card.chooseVariant",
    z.object({ cardId: z.string(), variantId: z.string(), confirm: z.boolean().optional() }),
  ),
  /** Phase 13: a project's automations; `save` always leaves them off. */
  cmd("automation.list", z.object({ projectId: z.string() })),
  cmd(
    "automation.save",
    z.object({
      projectId: z.string(),
      id: z.string().optional(),
      name: z.string().min(1),
      trigger: AutomationTrigger,
      action: AutomationAction,
      maxRunsPerDay: z.number().int().min(1).optional(),
      allowExternalAuthors: z.boolean().optional(),
    }),
  ),
  cmd("automation.remove", z.object({ id: z.string(), confirm: z.boolean().optional() })),
  /** Turning on needs `confirm`: the app shows the trigger and the action first. */
  cmd(
    "automation.toggle",
    z.object({ id: z.string(), enabled: z.boolean(), confirm: z.boolean().optional() }),
  ),
  cmd(
    "automation.runs",
    z.object({ id: z.string(), limit: z.number().int().min(1).max(500).optional() }),
  ),
  /** Phase 13: the project's issues (GitHub or Azure Boards) and cards made from them. */
  cmd("issues.list", z.object({ projectId: z.string(), query: z.string().min(1).optional() })),
  cmd("issues.get", z.object({ projectId: z.string(), id: z.string().min(1) })),
  cmd("issues.createCard", z.object({ projectId: z.string(), issueRef: z.string().min(1) })),
  /** Phase 13: the automatic approvals' decisions (newest first) and the suspended sessions. */
  cmd(
    "autoapprove.list",
    z.object({
      projectId: z.string().optional(),
      sessionKey: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  ),
  /** Turns the automatic approval back on in a session that got third-party content. */
  cmd("autoapprove.resume", z.object({ sessionKey: z.string(), confirm: z.boolean().optional() })),
  cmd(
    "agentcfg.read",
    z.object({
      projectId: z.string(),
      kind: AgentCfgKind,
      path: z.string().min(1),
      origin: AgentCfgOrigin.optional(),
    }),
  ),
  /** `expectedHash` is the hash read when the file was opened; null creates a new file. */
  cmd(
    "agentcfg.write",
    z.object({
      projectId: z.string(),
      kind: AgentCfgKind,
      path: z.string().min(1),
      content: z.string(),
      expectedHash: z.string().nullable(),
      confirm: z.boolean().optional(),
      origin: AgentCfgOrigin.optional(),
    }),
  ),
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
  /** `permissions.allow` of the project's `.claude/settings.local.json`. */
  cmd("rules.list", z.object({ projectId: z.string() })),
  cmd(
    "rules.remove",
    z.object({ projectId: z.string(), rule: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  // Phase 8 (track A).
  cmd("costs.status", z.object({}).strict()),
  cmd("costs.reprice", z.object({}).strict()),
  cmd("costs.summary", CostsFilter),
  cmd("costs.session", z.object({ claudeSessionId: z.string() })),
  cmd("costs.sessions", z.object({ claudeSessionIds: z.array(z.string()).max(500) })),
  cmd("costs.card", z.object({ cardId: z.string() })),
  cmd("costs.run", z.object({ runId: z.string() })),
  cmd("costs.export", CostsFilter),
  cmd("budget.list", z.object({}).strict()),
  cmd("budget.set", BudgetInput),
  cmd("budget.remove", z.object({ id: z.string() })),
  /** `budget.updated` after each change, threshold crossed or new period. */
  cmd("budget.watch", z.object({}).strict()),
  cmd(
    "quota.history",
    z.object({ window: z.string().min(1), hours: z.number().int().min(1).max(720) }),
  ),
  cmd("changes.get", z.object({ target: ReviewTarget })),
  cmd(
    "terminal.open",
    z
      .object({
        cwd: z.string().min(1),
        /** An argv, never run through a shell; the host's default shell when absent. */
        command: z.array(z.string().min(1)).min(1).max(64).optional(),
        /** "Claude aqui": `flightdeckd claude` in the cwd, with `--resume <id>` when given. */
        claude: z
          .object({
            resume: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "id de sessão inválido")
              .optional(),
            /** Phase 20: `--persona <id>` (a persona of the host, the project or the pack). */
            persona: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id de persona inválido")
              .optional(),
          })
          .optional(),
        cols: TerminalCols,
        rows: TerminalRows,
      })
      .refine((payload) => !(payload.command && payload.claude), {
        message: "command e claude não podem ir juntos",
      }),
  ),
  /** Keyboard input, UTF-8. */
  cmd("terminal.write", z.object({ terminalId: TerminalId, data: z.string().max(262_144) })),
  cmd(
    "terminal.resize",
    z.object({ terminalId: TerminalId, cols: TerminalCols, rows: TerminalRows }),
  ),
  /** Returns the scrollback and starts `terminal.data` frames for this connection. */
  cmd("terminal.attach", z.object({ terminalId: TerminalId })),
  cmd("terminal.detach", z.object({ terminalId: TerminalId })),
  /** `kill` ends the process; without it the terminal is only detached (and a dead one removed). */
  cmd("terminal.close", z.object({ terminalId: TerminalId, kill: z.boolean() })),
  cmd("terminal.list", z.object({}).strict()),
  /** Turns the host's terminals on (asks for `confirm`) or off (ends the live ones). */
  cmd("terminal.settings", z.object({ enabled: z.boolean(), confirm: z.boolean().optional() })),
  cmd("ssh.list", z.object({}).strict()),
  /** Creates (no `id`) or edits a destino; turning ForwardAgent on asks for `confirm`. */
  cmd(
    "ssh.save",
    z
      .object({
        id: z.string().optional(),
        name: z.string(),
        host: z.string(),
        port: z.number().int().optional(),
        user: z.string(),
        viaHost: z.string().nullable().optional(),
        auth: SshAuth.optional(),
        secretRef: z.string().nullable().optional(),
        jump: z.string().nullable().optional(),
        options: SshOptions.optional(),
        tags: z.array(z.string()).optional(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("ssh.remove", z.object({ id: z.string(), confirm: z.boolean() }).strict()),
  /** Reads the server key with ssh-keyscan and compares it with the one kept. */
  cmd("ssh.hostkey.check", z.object({ targetId: z.string() }).strict()),
  /** Keeps the key whose fingerprint `check` just showed; replacing one asks to forget it first. */
  cmd("ssh.hostkey.confirm", z.object({ targetId: z.string(), fingerprint: z.string() }).strict()),
  cmd("ssh.hostkey.forget", z.object({ targetId: z.string() }).strict()),
  /**
   * Opens a terminal running ssh to the destino. `privateKey` is the key from the vault, for
   * `vault-key` only; it is delivered for this connection and never stored or logged.
   */
  cmd(
    "ssh.connect",
    z
      .object({
        targetId: z.string(),
        cols: TerminalCols,
        rows: TerminalRows,
        privateKey: z.string().max(65_536).optional(),
      })
      .strict(),
  ),
  /** `ssh -o BatchMode=yes ... exit 0`: no terminal, the error translated. */
  cmd(
    "ssh.test",
    z.object({ targetId: z.string(), privateKey: z.string().max(65_536).optional() }).strict(),
  ),
  /** Follow `askpass.request` frames: the app that answers a ssh password prompt. */
  cmd("askpass.watch", z.object({}).strict()),
  /** What `flightdeckd askpass` calls with the ticket of its connection; returns the answer. */
  cmd("askpass.ask", z.object({ ticket: z.string(), prompt: z.string().max(500) }).strict()),
  /** The app answers a request; `null` refuses. */
  cmd(
    "askpass.answer",
    z.object({ requestId: z.string(), secret: z.string().max(4096).nullable() }).strict(),
  ),
  /** Snippets of the host and, with `projectPath`, of that project, favorites and recents first. */
  cmd(
    "snippets.list",
    z
      .object({
        scope: z.enum(["host", "project", "all"]).optional(),
        projectPath: z.string().optional(),
        query: z.string().optional(),
        tag: z.string().optional(),
        type: z.enum(["command", "prompt"]).optional(),
      })
      .strict(),
  ),
  /** Creates (no `id`) or edits a snippet; a secret in it is refused with `snippet_secret`. */
  cmd(
    "snippets.save",
    z
      .object({
        ...SnippetInput.shape,
        id: z.string().optional(),
        scope: SnippetScope,
        target: z.enum(["daemon", "file"]).optional(),
        projectPath: z.string().optional(),
      })
      .strict(),
  ),
  /** By `id`, or by `name` (the host's, then the `projectPath`'s). */
  cmd(
    "snippets.get",
    z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        projectPath: z.string().optional(),
      })
      .strict()
      .refine((p) => p.id !== undefined || p.name !== undefined, { message: "id ou name" }),
  ),
  cmd("snippets.remove", z.object({ id: z.string() }).strict()),
  /** Trusts the content of the project's versioned file, by the hash `snippets.list` showed. */
  cmd("snippets.trust", z.object({ projectPath: z.string(), hash: z.string() }).strict()),
  cmd("snippets.favorite", z.object({ id: z.string(), favorite: z.boolean() }).strict()),
  /** Reads a YAML or JSON list of snippets (an import from a file); saves nothing. */
  cmd("snippets.parse", z.object({ text: z.string().max(1_000_000) }).strict()),
  /**
   * The most used commands of this host's shell histories (read only, secrets hidden). With
   * `select` (ids of the candidates) it also makes them snippets of the host.
   */
  cmd(
    "snippets.importHistory",
    z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        reveal: z.boolean().optional(),
        select: z.array(z.string()).max(200).optional(),
      })
      .strict(),
  ),
  /** The text a snippet would produce with these values and context, and the fields it asks for. */
  cmd(
    "snippets.render",
    z
      .object({
        id: z.string(),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
      })
      .strict(),
  ),
  /**
   * Uses a snippet: `paste` types a command into a terminal (`enter` also runs it), `run` opens a
   * new tab at `context.cwd`, `send` sends a prompt to a session (`sessionId` or `claudeSessionId`).
   */
  cmd(
    "snippets.use",
    z
      .object({
        id: z.string(),
        action: z.enum(["paste", "run", "send"]),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
        terminalId: z.string().optional(),
        enter: z.boolean().optional(),
        cols: TerminalCols.optional(),
        rows: TerminalRows.optional(),
        sessionId: z.string().optional(),
        claudeSessionId: z.string().optional(),
      })
      .strict(),
  ),
  /** The personas of the host and, with `projectPath`, of that project. */
  cmd(
    "personas.list",
    z
      .object({
        scope: z.enum(["host", "project", "all"]).optional(),
        projectPath: z.string().optional(),
        /** The language of the pack personas that are shown (`pt-BR` when absent). */
        language: z.enum(["pt-BR", "en"]).optional(),
      })
      .strict(),
  ),
  /** Creates or edits a persona; a secret in it is refused with `persona_secret`. */
  cmd(
    "personas.save",
    z
      .object({
        scope: z.enum(["host", "project"]),
        projectPath: z.string().optional(),
        persona: PersonaInput,
      })
      .strict(),
  ),
  cmd(
    "personas.remove",
    z
      .object({
        scope: z.enum(["host", "project"]),
        id: z.string(),
        projectPath: z.string().optional(),
      })
      .strict(),
  ),
  /** Applies a persona to an open session, managed (`sessionId`) or from a terminal (`claudeSessionId`). */
  cmd(
    "session.applyPersona",
    z
      .object({
        sessionId: z.string().optional(),
        claudeSessionId: z.string().optional(),
        persona: PersonaRef,
      })
      .strict()
      .refine((p) => (p.sessionId === undefined) !== (p.claudeSessionId === undefined), {
        message: "informe sessionId ou claudeSessionId, um dos dois",
      }),
  ),
  /** Leaves the role that was applied: back to normal. */
  cmd(
    "session.clearPersona",
    z
      .object({
        sessionId: z.string().optional(),
        claudeSessionId: z.string().optional(),
        language: z.enum(["pt-BR", "en"]).optional(),
      })
      .strict()
      .refine((p) => (p.sessionId === undefined) !== (p.claudeSessionId === undefined), {
        message: "informe sessionId ou claudeSessionId, um dos dois",
      }),
  ),
  /** The personas that hold in the project, as the agents `persona-<id>` a session can call. */
  cmd(
    "personas.subagents",
    z
      .object({
        projectPath: z.string().optional(),
        language: z.enum(["pt-BR", "en"]).optional(),
      })
      .strict(),
  ),
  /** Writes a persona as the project agent `.claude/agents/persona-<id>.md`; asks for `confirm`. */
  cmd(
    "personas.publishAgent",
    z
      .object({
        id: z.string(),
        projectPath: z.string(),
        language: z.enum(["pt-BR", "en"]).optional(),
        confirm: z.boolean(),
      })
      .strict(),
  ),
  /** The persona to use, as `session.create` and `flightdeckd claude --persona` would resolve it. */
  cmd(
    "personas.resolve",
    z.object({ ref: PersonaRef, projectPath: z.string().optional() }).strict(),
  ),
  /** Puts a pack persona back as it came (the host's edit goes away). */
  cmd(
    "personas.reset",
    z.object({ id: z.string(), language: z.enum(["pt-BR", "en"]).optional() }).strict(),
  ),
  /** Trusts a project's versioned persona, by the hash `personas.list` showed. */
  cmd(
    "personas.trust",
    z.object({ projectPath: z.string(), id: z.string(), hash: z.string() }).strict(),
  ),
  /** Reads this host's `~/.ssh/config` (never writes it) and says what would be created. */
  cmd("ssh.import.preview", z.object({}).strict()),
  /** Creates the chosen names; the ones it cannot create come back with the reason. */
  cmd("ssh.import.apply", z.object({ aliases: z.array(z.string()).max(500) }).strict()),
  cmd("pr.comments", CardIdPayload),
  /** The data of `flightdeckd statusline`: quota windows, today's cost and the session's. */
  cmd("statusline.get", z.object({ claudeSessionId: z.string().optional() })),
  /** The sessions that wrote a file, by its absolute path. */
  cmd("files.sessions", z.object({ path: z.string().min(1) })),
  cmd("session.files", z.object({ claudeSessionId: z.string() })),
  cmd("pr.comments.send", z.object({ cardId: z.string(), ids: z.array(z.string()).min(1) })),
  /** Rebase on the base; a conflict aborts it and leaves the worktree as it was. */
  cmd("card.updateFromBase", CardIdPayload),
  /** "Merge e arquivar", for a card without a PR; `merge` is `--no-ff`. */
  cmd(
    "card.mergeLocal",
    z.object({
      cardId: z.string(),
      mode: z.enum(["merge", "squash"]).default("merge"),
      confirm: z.boolean().optional(),
    }),
  ),
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
  cmd("review.send", z.object({ target: ReviewTarget })),
  cmd(
    "changes.revert",
    z.object({ target: ReviewTarget, path: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  cmd(
    "changes.undoRevert",
    z.object({ target: ReviewTarget, path: z.string().min(1), confirm: z.boolean().optional() }),
  ),
  cmd("file.read", z.object({ target: ReviewTarget, path: z.string().min(1) })),
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

/** Phase 12: one git snapshot of a turn (`before`, `after`, or `safety` before a rewind). */
export const SnapshotInfo = z.object({
  claudeSessionId: z.string(),
  n: z.number().int(),
  ref: z.string(),
  tree: z.string(),
  kind: z.string(),
  turnUuid: z.string().nullable(),
  prompt: z.string().nullable(),
  createdAt: z.string(),
  repo: z.string(),
});
export type SnapshotInfo = z.infer<typeof SnapshotInfo>;

/** Phase 12: the files one turn changed, and the lines added and removed. */
export const SnapshotFiles = z.object({
  files: z.array(z.object({ path: z.string(), change: z.string() })),
  insertions: z.number().int(),
  deletions: z.number().int(),
});
export type SnapshotFiles = z.infer<typeof SnapshotFiles>;

/** Phase 12: what a rewind changes, by the SDK's checkpoint or by the snapshot. */
export const RewindPreview = z.object({
  via: z.enum(["sdk", "snapshot"]),
  files: z.array(z.object({ path: z.string(), change: z.string() })),
  insertions: z.number().int(),
  deletions: z.number().int(),
});
export type RewindPreview = z.infer<typeof RewindPreview>;

/** Phase 9: `daemon-latest.json`, published with each release. */
export const DaemonManifest = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  protocol: z.number().int(),
  assets: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      signature: z.string(),
    }),
  ),
});
export type DaemonManifest = z.infer<typeof DaemonManifest>;

/** What the daemon found the last time it checked its manifest. */
export const UpdateStatus = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  checkedAt: z.string(),
  error: z.string().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

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
  /** Phase 9: the last check of the daemon's release manifest; absent when it does not check. */
  update: UpdateStatus.optional(),
  /** Phase 8: the stable `flightdeckd` (phase 7) when installed; "Abrir no terminal" runs it. */
  flightdeckdPath: z.string().nullable().optional(),
  /** Phase 8: the WSL distro this daemon runs in, `null` outside WSL. */
  wslDistro: z.string().nullable().optional(),
  /** Phase 14: the host's terminals: on or off, how many at most, which shell. */
  terminal: TerminalSettings.optional(),
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
  "daemon.update.apply": { started: true };
  "snapshots.list": { snapshots: SnapshotInfo[] };
  "snapshots.files": SnapshotFiles;
  "rewind.preview": RewindPreview;
  "rewind.apply": RewindPreview;
  "rewind.undo": RewindPreview;
  "session.fork": { claudeSessionId: string; sessionId?: string; command?: string };
  "mcp.list": { servers: McpServerView[] };
  "mcp.test":
    | { preview: { command?: string; args?: string[]; url?: string } }
    | { tools: string[]; resources: string[] };
  "mcp.save": { servers: McpServerView[] };
  "mcp.remove": { servers: McpServerView[] };
  "mcp.toggle": { servers: McpServerView[] };
  "mcp.status": { servers: McpLiveStatus[] };
  "agentcfg.list": { items: AgentCfgItem[] };
  "actions.list": ActionList;
  "actions.save": ActionInfo;
  "actions.remove": ActionList;
  "actions.trust": ActionInfo;
  "actions.run": ActionResult;
  "actions.runFree": ActionResult;
  "actions.runs": { runs: ActionRunInfo[] };
  "vault.watch": undefined;
  "vault.deny": undefined;
  "teams.list": { teams: TeamInfo[] };
  "teams.create": TeamInfo;
  "teams.update": TeamInfo;
  "teams.pause": TeamInfo;
  "teams.resume": TeamInfo;
  "teams.close": TeamInfo;
  "teams.message": { delivered: number; refused: number };
  "teams.status": TeamStatus;
  "teams.watch": undefined;
  "messages.send": SendResult;
  "messages.list": { messages: MessageInfo[] };
  "messages.sessions": { sessions: MessagingSession[] };
  "messages.read": ReadSessionResult;
  "messages.relay": SendResult;
  "messages.relayed": undefined;
  "messages.peers": undefined;
  "messages.directory": { host: string; sessions: MessagingPeer[] };
  "messages.watch": undefined;
  "idle.subscribe": { fired: boolean };
  "messaging.rules.get": { policy: Record<string, unknown>; paused: string[] };
  "messaging.rules.set": { policy: Record<string, unknown>; paused: string[] };
  "vault.rules.set": { rules: number };
  "vault.rules.get": { secretId: string; tags: string[]; rules: unknown[] };
  "vault.rules.preview": VaultVerdict;
  "vault.approve": undefined;
  "vault.decisions": { decisions: VaultDecisionInfo[] };
  "vault.report": { rows: VaultReportRow[]; csv?: string };
  "vault.deliver": { expiresAt: number };
  "vault.use": { result: string };
  "card.startArena": Arena;
  "card.arena": Arena;
  "card.chooseVariant": Card;
  "automation.list": { automations: Automation[] };
  "automation.save": Automation;
  "automation.remove": { automations: Automation[] };
  "automation.toggle": Automation;
  "automation.runs": { runs: AutomationRun[] };
  "issues.list": { issues: Issue[] };
  "issues.get": Issue;
  "issues.createCard": Card;
  "autoapprove.list": { decisions: AutoApprovalRecord[]; suspended: AutoApproveSuspension[] };
  "autoapprove.resume": { suspended: AutoApproveSuspension[] };
  "agentcfg.read": AgentCfgItem & { content: string };
  "agentcfg.write": { hash: string };
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
  "rules.list": { rules: string[] };
  "rules.remove": { rules: string[] };
  "costs.status": CostsStatus;
  "costs.reprice": { entries: number };
  "costs.summary": CostsSummary;
  "costs.session": CostsSession;
  /** Only the sessions that have entries. */
  "costs.sessions": { costs: Record<string, number> };
  "costs.card": { costUsd: number };
  "costs.run": { costUsd: number };
  "costs.export": { csv: string; filename: string };
  "budget.list": { budgets: Budget[] };
  "budget.set": Budget;
  "budget.remove": undefined;
  "budget.watch": undefined;
  "quota.history": QuotaHistory;
  "changes.get": ChangesResult;
  "pr.comments": { comments: PrComment[] };
  "terminal.open": TerminalInfo;
  "terminal.write": undefined;
  "terminal.resize": undefined;
  "terminal.attach": TerminalAttachResult;
  "terminal.detach": undefined;
  "terminal.close": undefined;
  "terminal.list": { terminals: TerminalInfo[] };
  "terminal.settings": TerminalSettings;
  "ssh.list": { targets: SshTarget[] };
  "ssh.save": SshTarget;
  "ssh.remove": undefined;
  "snippets.list": { snippets: Snippet[]; file: SnippetFileInfo | null };
  "snippets.save": Snippet;
  "snippets.get": Snippet;
  "snippets.remove": undefined;
  "snippets.trust": SnippetFileInfo;
  "snippets.favorite": Snippet;
  "snippets.parse": { snippets: SnippetInput[]; errors: string[] };
  "snippets.importHistory": SnippetHistoryResult;
  "personas.list": { personas: Persona[]; project: PersonaProjectInfo | null };
  "personas.save": Persona;
  "personas.remove": undefined;
  "personas.reset": Persona;
  "personas.resolve": ResolvedPersonaResult;
  "personas.subagents": PersonaSubagents;
  "personas.publishAgent": { path: string };
  "session.applyPersona": PersonaSwitchResult;
  "session.clearPersona": PersonaSwitchResult;
  "personas.trust": Persona;
  "snippets.render": { text: string; fields: SnippetField[] };
  "snippets.use": { text: string; terminal: TerminalInfo | null };
  "askpass.watch": undefined;
  "askpass.ask": { secret: string };
  "askpass.answer": undefined;
  "ssh.connect": TerminalInfo;
  "ssh.test": SshTestResult;
  "ssh.hostkey.check": SshHostKeyCheck;
  "ssh.hostkey.confirm": SshTarget;
  "ssh.hostkey.forget": SshTarget;
  "ssh.import.preview": { entries: SshImportEntry[] };
  "ssh.import.apply": SshImportResult;
  "statusline.get": {
    windows: Array<{ window: string; utilization: number | null }>;
    todayUsd: number;
    sessionUsd: number | null;
  };
  "files.sessions": { sessions: FileSession[] };
  "session.files": { files: SessionFile[] };
  "pr.comments.send": { sent: number };
  "card.updateFromBase": Card;
  "card.mergeLocal": Card;
  "changes.watch": undefined;
  "changes.unwatch": undefined;
  "review.list": { comments: ReviewComment[] };
  "review.add": ReviewComment;
  "review.update": ReviewComment | null;
  "review.remove": undefined;
  "review.send": ReviewSent;
  /** Undo with `changes.undoRevert` until `undoUntil`. */
  "changes.revert": { path: string; undoUntil: string };
  "changes.undoRevert": { path: string };
  /** `hash`: sha256 of the bytes, hex, for `file.write`. */
  "file.read": { path: string; text: string; hash: string; size: number };
  "file.write": { path: string; hash: string; size: number };
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
  "invalid_permission_update",
  "update_verification_failed",
  "update_needs_service",
  /** `file.write` of a file that changed since it was read (phase 11). */
  "file_conflict",
  /** A terminal command on a host that has the terminal off (phase 14). */
  "terminal_disabled",
  /** `ssh.connect` to a server whose key was never confirmed, or whose key changed (phase 15). */
  "hostkey_unconfirmed",
  "hostkey_changed",
  /** Running a command from a project's versioned snippets file that is not trusted (phase 18). */
  "snippet_untrusted",
  /** A persona with a secret in it (phase 20). */
  "persona_secret",
  /** Using a persona from a project's versioned files that is not trusted yet (phase 20). */
  "persona_untrusted",
  /** A snippet with a secret in it; the app offers "Transformar em ação" (phase 18). */
  "snippet_secret",
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
  /** The hook's `permission_suggestions` this daemon understands (phase 7). */
  suggestions: z.array(PermissionUpdate).optional(),
  /** Phase 13: from the whole input, before it is cut. */
  risk: RiskLevel.optional(),
  riskReason: z.string().optional(),
  state: z.enum(["open", "closed"]),
  /** Why it closed: answered here, the hook connection dropped, or answered in the terminal. */
  resolution: z.enum(["allow", "deny", "dropped", "answered_elsewhere"]).optional(),
  /** Phase 13: approved automatically, and why. */
  auto: AutoApproval.optional(),
  createdAt: z.string(),
});
export type ExternalPermissionFrame = z.infer<typeof ExternalPermissionFrame>;

/** Sent after `run.watch` with the whole workflow run after each change. Not a session event. */
export const RunUpdated = z.object({ type: z.literal("run.updated"), run: WorkflowRun });
export type RunUpdated = z.infer<typeof RunUpdated>;

/** Sent after `quota.watch` with the host's windows after each new reading or expiry. */
export const QuotaUpdated = z.object({ type: z.literal("quota.updated"), ...QuotaState.shape });
export type QuotaUpdated = z.infer<typeof QuotaUpdated>;

/** Sent after `budget.watch`: a budget changed, crossed a threshold or entered a new period. */
export const BudgetUpdated = z.object({
  type: z.literal("budget.updated"),
  budget: Budget,
  /** The highest threshold just crossed (0.5, 0.8 or 1); `null` for other changes. */
  threshold: z.number().nullable(),
  removed: z.boolean(),
});
export type BudgetUpdated = z.infer<typeof BudgetUpdated>;

/** Sent after `changes.watch`: the target's diff after a change on disk. */
export const ChangesUpdated = z.object({
  type: z.literal("changes.updated"),
  ...ChangesResult.shape,
});
export type ChangesUpdated = z.infer<typeof ChangesUpdated>;

/** Output of an attached terminal: base64, in frames of at most 16 KB every 16 ms. */
export const TerminalData = z.object({
  type: z.literal("terminal.data"),
  terminalId: z.string(),
  data: z.string(),
});
export type TerminalData = z.infer<typeof TerminalData>;

/** The process of a terminal ended (after the last of its output). */
export const TerminalExited = z.object({
  type: z.literal("terminal.exited"),
  terminalId: z.string(),
  exitCode: z.number().int(),
});
export type TerminalExited = z.infer<typeof TerminalExited>;

/**
 * This connection could not follow the terminal's output and lost it: attach again, which
 * returns the scrollback to continue from. Nothing more arrives until it does.
 */
export const TerminalResync = z.object({
  type: z.literal("terminal.resync"),
  terminalId: z.string(),
});
export type TerminalResync = z.infer<typeof TerminalResync>;

/**
 * Phase 16: a use that needs a secret, asked of the app by the daemon. In this phase no daemon
 * feature asks, and a request that names `you` does not parse (the app treats it as unknown).
 */
export const VaultRequestFrame = z.object({
  type: z.literal("vault.request"),
  requestId: z.string(),
  secretId: z.string(),
  purpose: z.string(),
  requester: VaultDaemonRequester,
  /** Phase 17: the action that needs it, its parameters and how it asks for approval. */
  action: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  approval: z.enum(["always", "never", "first-per-session"]).optional(),
  /** Phase 17: for `run_with_secret`, exactly what would run, with which secrets, and where. */
  command: z.string().optional(),
  secrets: z.array(z.string()).optional(),
  host: z.string().optional(),
  /** Phase 19: what the rules decided, and which rule did. `allow` is delivered without asking. */
  decision: z.enum(["allow", "ask"]).optional(),
  ruleId: z.string().nullable().optional(),
  reason: z.string().optional(),
  /** Ask once per session (the approval can be given for the session). */
  once: z.boolean().optional(),
  /** Prod or high risk: the Approve button is held for 2 s and the tray cannot approve. */
  needsHold: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  /** The request is denied if nobody answers by then (milliseconds since the epoch). */
  expiresAt: z.number().optional(),
});
export type VaultRequestFrame = z.infer<typeof VaultRequestFrame>;

/** Phase 16: a delivered secret was used (for the app's usage log); never carries the value. */
export const VaultUsed = z.object({
  type: z.literal("vault.used"),
  secretId: z.string(),
  purpose: z.string(),
  requester: VaultRequester,
  action: z.string(),
  at: z.string(),
});
export type VaultUsed = z.infer<typeof VaultUsed>;

export const MessagingPolicyException = z.object({
  id: z.string().min(1),
  from: z.record(z.string(), z.string()),
  to: z.record(z.string(), z.string()),
  bothWays: z.boolean().optional(),
});

/** One session read through `read_session`: the summary line and the last messages. */
export const ReadSessionResult = z.object({
  summary: SessionLine.nullable(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
});
export type ReadSessionResult = z.infer<typeof ReadSessionResult>;

export const MessagesUpdatedFrame = z.object({
  type: z.literal("messages.updated"),
  message: MessageInfo,
});
export type MessagesUpdatedFrame = z.infer<typeof MessagesUpdatedFrame>;
export const MessagesRelayFrame = z.object({
  type: z.literal("messages.relay"),
  message: RelayMessage,
});
export type MessagesRelayFrame = z.infer<typeof MessagesRelayFrame>;
export const MessagingAlertFrame = z.object({
  type: z.literal("messaging.alert"),
  kind: z.literal("loop"),
  from: z.string(),
  to: z.string(),
  message: z.string(),
  at: z.string(),
});
export type MessagingAlertFrame = z.infer<typeof MessagingAlertFrame>;
export const IdleFiredFrame = z.object({
  type: z.literal("idle.fired"),
  watcher: z.string(),
  session: z.string(),
  at: z.string(),
});
export type IdleFiredFrame = z.infer<typeof IdleFiredFrame>;

/** Phase 19: a warning for the app, even where a rule lets the use through. */
export const VaultAlertFrame = z.object({
  type: z.literal("vault.alert"),
  kind: z.enum(["new-requester", "limit"]),
  secretId: z.string(),
  requester: VaultRequester,
  message: z.string(),
  at: z.string(),
});
export type VaultAlertFrame = z.infer<typeof VaultAlertFrame>;

export const VaultVerdict = z.object({
  decision: z.enum(["allow", "ask", "deny"]),
  ruleId: z.string().nullable(),
  reason: z.string(),
  once: z.boolean(),
  needsHold: z.boolean(),
  limited: z.boolean(),
});
export type VaultVerdict = z.infer<typeof VaultVerdict>;

export const VaultOutcome = z.enum([
  "pending",
  "allowed",
  "approved",
  "denied",
  "expired",
  "refused",
  "failed",
]);
export type VaultOutcome = z.infer<typeof VaultOutcome>;

/** Phase 19: one decision about a use of a secret, for the audit. */
export const VaultDecisionInfo = z.object({
  id: z.string(),
  at: z.string(),
  secretId: z.string(),
  requester: VaultRequester,
  purpose: z.enum(["ssh", "action", "run_with_secret"]),
  action: z.string().nullable(),
  host: z.string(),
  project: z.string().nullable(),
  session: z.string().nullable(),
  ruleId: z.string().nullable(),
  decision: z.enum(["allow", "ask", "deny"]),
  outcome: VaultOutcome,
  /** Who let it through: the rule, the app, the tray or an approval earlier in the session. */
  approver: z.enum(["rule", "app", "tray", "session"]).nullable(),
  /** The rule's time window, as it was. */
  window: z.string().nullable(),
  reason: z.string(),
});
export type VaultDecisionInfo = z.infer<typeof VaultDecisionInfo>;

export const VaultReportRow = z.object({
  secretId: z.string(),
  requester: VaultRequester,
  outcome: VaultOutcome,
  count: z.number().int(),
});
export type VaultReportRow = z.infer<typeof VaultReportRow>;

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
  AskpassRequest,
  BudgetUpdated,
  ChangesUpdated,
  TerminalData,
  TerminalExited,
  TerminalResync,
  VaultRequestFrame,
  VaultUsed,
  VaultAlertFrame,
  TeamsUpdatedFrame,
  MessagesUpdatedFrame,
  MessagesRelayFrame,
  MessagingAlertFrame,
  IdleFiredFrame,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parses a raw JSON frame into a `ServerMessage`, throwing on invalid input. */
export function parseServerMessage(raw: string): ServerMessage {
  return ServerMessage.parse(JSON.parse(raw));
}

export * from "./pairing.ts";
export * from "./personas.ts";
export * from "./snippets.ts";

/**
 * Phase 19: the one rule for a production tag, shared by the daemon's rules and the app's
 * warnings: `prod`, `produção` or `producao`, in any case.
 */
const PROD_TAGS: ReadonlySet<string> = new Set(["prod", "produ\u00e7\u00e3o", "producao"]);

export function isProdTag(tag: string): boolean {
  return PROD_TAGS.has(tag.toLowerCase());
}

/** Whether any of the tags marks production. */
export function isProd(tags: readonly string[] | undefined): boolean {
  return (tags ?? []).some(isProdTag);
}
