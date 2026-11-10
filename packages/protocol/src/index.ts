import { z } from "zod";
import {
  type AgentSetupResults,
  agentSetupCommands,
  HARNESS_DIGESTS_MAX,
  HARNESS_PREVIEW_PARTS,
  HARNESS_TEMPLATE_ID,
  type HarnessApplied,
  type HarnessCommitted,
  type HarnessDraft,
  type HarnessPreview,
  type HarnessStack,
  type HarnessTemplateInfo,
} from "./agent-setup.ts";
import {
  AssistantCancelPayload,
  type AssistantContextBundle,
  AssistantContextPayload,
  AssistantRecordPayload,
  type AssistantResult,
  AssistantRunPayload,
} from "./assistant.ts";
import {
  type CardTemplates,
  ColumnContract,
  PINNED_DOCS_MAX,
  pinnedDocProblem,
  SPEC_PATH_MAX,
  SpecState,
  specPathProblem,
  type ValidationTemplate,
} from "./board-contracts.ts";
import {
  type CollaborationResults,
  collaborationCommands,
  IdleFiredFrame,
  MessagesRelayFrame,
  MessagesUpdatedFrame,
  MessagingAlertFrame,
  SessionIdentity,
  TeamsUpdatedFrame,
} from "./collaboration.ts";
import { cmd } from "./command.ts";
import { isBranchName } from "./git-ref.ts";
import { type HostResults, hostCommands } from "./host.ts";
import { LocalizedText } from "./localized-text.ts";
import {
  AutoApproval,
  AutoApproveSettings,
  PendingPermission,
  PermissionMode,
  PermissionResolution,
  type PermissionsResults,
  PermissionUpdate,
  PlainInfo,
  permissionsCommands,
  RiskLevel,
  SettableMode,
  ToolInput,
} from "./permissions.ts";
import {
  PersonaRef,
  PersonaSubagentsMode,
  type PersonaSwitchResult,
  type PersonasResults,
  personasCommands,
  SessionPersona,
} from "./personas.ts";
import { type RunConfigInfo, RunState } from "./run.ts";
import {
  AskpassRequest,
  type SecretsResults,
  secretsCommands,
  VaultAlertFrame,
  VaultRequestFrame,
  VaultUsed,
} from "./secrets.ts";
import {
  ListExtras,
  SessionLine,
  SessionMeta,
  type SessionNameInfo,
  SessionRuntime,
  SessionStatus,
  SessionSummary,
} from "./sessions.ts";
import { type SnippetsResults, snippetsCommands } from "./snippets.ts";
import { type TeleportResults, teleportCommands } from "./teleport.ts";
import {
  TerminalData,
  TerminalExited,
  type TerminalResults,
  TerminalResync,
  terminalCommands,
} from "./terminal.ts";
import {
  AccountUpdated,
  BudgetUpdated,
  QuotaUpdated,
  Usage,
  type UsageResults,
  usageCommands,
} from "./usage.ts";

export const PROTOCOL_VERSION = 1;
/** Oldest client protocol this daemon still serves. */
export const MIN_PROTOCOL_VERSION = 1;
export const WS_PATH = "/v1/ws";

/** Close code used when authentication fails or a frame arrives before `hello`. */
export const CLOSE_UNAUTHORIZED = 4401;

/** Close code used when a client misses two heartbeats in a row. */
export const CLOSE_HEARTBEAT = 4408;

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

/** A slash command of a session, as the app lists it after `/`. */
export const SlashCommandInfo = z.object({
  /** Without the slash. */
  name: z.string(),
  description: z.string(),
  /** What to type after the name (`<file>`), when the command takes an argument. */
  argumentHint: z.string().optional(),
  /** Claude Code's own command, an MCP server's prompt, or a skill (a user, project or plugin one). */
  kind: z.enum(["builtin", "skill", "mcp"]),
});
export type SlashCommandInfo = z.infer<typeof SlashCommandInfo>;

export const SessionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    cwd: z.string(),
    name: z.string().nullable(),
    permissionMode: PermissionMode,
    persona: SessionPersona.optional(),
    /** The Claude session this one continues (a resume from History), so the screen can show its turns. */
    resumedFrom: z.string().optional(),
  }),
  z.object({
    type: z.literal("session.status"),
    status: SessionStatus,
    reason: z.string().optional(),
  }),
  /** #935: the mode the session runs in now, after a change the run took (the start mode stays the limit). */
  z.object({
    type: z.literal("session.mode"),
    permissionMode: PermissionMode,
  }),
  z.object({
    type: z.literal("session.init"),
    claudeSessionId: z.string(),
    model: z.string(),
    tools: z.array(z.string()),
    /** The slash commands the session has (`/compact`, a skill, ...), without the slash. */
    slashCommands: z.array(z.string()).optional(),
    /** Phase 39: project files sent with the first prompt as context (`AGENTS.md`), by name. */
    contextFiles: z.array(z.string()).optional(),
    /** Phase 39: project files left out (too large), by name. */
    contextSkipped: z.array(z.string()).optional(),
    /** The same commands with a description and a kind; an older daemon sends the names only. */
    commands: z.array(SlashCommandInfo).optional(),
  }),
  /** `images`: how many came with the message (the bytes stay out of the log). */
  z.object({
    type: z.literal("message.user"),
    text: z.string(),
    images: z.number().int().positive().optional(),
  }),
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
    /** Phase 33: the request in plain words, worded by the host (it knows the files). */
    plain: PlainInfo.optional(),
  }),
  z.object({
    type: z.literal("permission.resolved"),
    requestId: z.string(),
    decision: PermissionResolution,
    message: z.string().optional(),
    /** Phase 13: approved automatically, and why. */
    auto: AutoApproval.optional(),
    /** AskUserQuestion: question text to the chosen answer; older apps ignore it. */
    answers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("turn.result"),
    subtype: z.string(),
    isError: z.boolean(),
    durationMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    usage: Usage.optional(),
  }),
  /** `reason` and `params` (phase 39): a typed refusal the app translates, like a command's. */
  z.object({
    type: z.literal("session.error"),
    code: z.string(),
    message: z.string(),
    reason: z.string().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  z.object({
    type: z.literal("session.summary"),
    sessionId: z.string(),
    name: z.string().nullable(),
    cwd: z.string(),
    status: SessionStatus,
    /** Open requests, oldest first; the count is its length. */
    pendingPermissions: z.array(PendingPermission),
    updatedAt: z.string(),
    /** Phase 39: set for an OpenCode session only. */
    runtime: SessionRuntime.optional(),
    /** Issue #463: its folder's trust was revoked after the run loaded the project's setup; set when true only. */
    trustStale: z.boolean().optional(),
    /** Issue #1478 (host `stall`): the session went quiet at this time; absent when it did not. */
    quietSince: z.string().optional(),
    /** Issue #1478: the last tool it called; `null` when it called none. */
    quietTool: z.string().nullable().optional(),
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
  /** None: the session starts idle and waits for its first message. */
  prompt: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  permissionMode: PermissionMode.optional(),
  model: z.string().min(1).optional(),
  /** Phase 13: for a session that is not resumed later (arena variants). */
  effort: EffortLevel.optional(),
  /** Opens the session in a persona's role (phase 20). */
  persona: PersonaRef.optional(),
  /** Phase 39: the agent to run; `claude` when absent. */
  runtime: SessionRuntime.optional(),
});

/** What a message may carry as images: the types the API reads, five of them, 5 MB each. */
export const SESSION_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const SESSION_IMAGE_MAX_COUNT = 5;
export const SESSION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** One image of a message: its type and its bytes in base64. */
export const SessionImage = z.object({
  mediaType: z.enum(SESSION_IMAGE_TYPES),
  /** Base64 of at most `SESSION_IMAGE_MAX_BYTES` bytes. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil((SESSION_IMAGE_MAX_BYTES * 4) / 3) + 4),
});
export type SessionImage = z.infer<typeof SessionImage>;

export const SessionSendPayload = z
  .object({
    sessionId: z.string(),
    text: z.string(),
    images: z.array(SessionImage).max(SESSION_IMAGE_MAX_COUNT).optional(),
  })
  .refine((p) => p.text.length > 0 || (p.images?.length ?? 0) > 0, {
    message: "a message needs text or an image",
  });
export const SessionIdPayload = z.object({ sessionId: z.string() });
export const SessionSubscribePayload = z.object({
  sessionId: z.string(),
  sinceSeq: z.number().int().nonnegative().optional(),
});

/** The host refuses a high-risk `permission.respond` allow that does not carry `held: true`. */
export const FEATURE_HOLD_PROOF = "hold-proof";

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

// Phase 4: projects (git repositories of the host) and their boards of cards.
export const PrProviderKind = z.enum(["github", "azure-devops", "none"]);
export type PrProviderKind = z.infer<typeof PrProviderKind>;

export const BoardColumn = z.enum(["backlog", "in_progress", "waiting", "review", "done"]);
export type BoardColumn = z.infer<typeof BoardColumn>;

export const PrState = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof PrState>;

export const ChecksState = z.enum(["pending", "passing", "failing"]);
export type ChecksState = z.infer<typeof ChecksState>;

/** Issue #1352: whether a PR can be merged as it is, as its host reports it. */
export const PrMergeable = z.enum(["clean", "conflict", "blocked", "unknown"]);
export type PrMergeable = z.infer<typeof PrMergeable>;

/** Issue #1352: where the PR stands with its reviewers. */
export const PrReview = z.enum(["approved", "changes_requested", "required", "none"]);
export type PrReview = z.infer<typeof PrReview>;

/** Issue #1405: another card of the project that changes some of the same files. */
export const MayConflict = z.object({
  cardId: z.string(),
  title: z.string(),
  /** The files both cards change (capped by the daemon). */
  files: z.array(z.string()),
});
export type MayConflict = z.infer<typeof MayConflict>;

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
export const Project = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  baseBranch: z.string(),
  /**
   * The base branch is not a branch name (an older daemon stored it without checking): opening a PR
   * and updating from the remote refuse it, and every git step refuses an option, until the person
   * sets a real one (issue #369).
   */
  baseBranchInvalid: z.boolean().optional(),
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
  /** Issue #78: what each column asks of a card; a column left out keeps the app's default. */
  contractByColumn: z.partialRecord(BoardColumn, ColumnContract).default({}),
  /** The personas offered as `persona-<id>` subagents in this project (phase 20). */
  personaSubagents: PersonaSubagentsMode.default("all"),
  /** Phase 36: the hours a done card is worth when it has no estimate of its own. */
  defaultHours: z.number().nullable().default(null),
  /** Phase 36: the optional value signals this project has switched on (both off by default). */
  roiSignals: z
    .object({ commits: z.boolean(), issues: z.boolean() })
    .default({ commits: false, issues: false }),
  /**
   * Phase 29: the project key of the folder (the normalized remote, else the folder on this host),
   * the same one sessions and costs carry; absent from a daemon that does not send it.
   */
  projectKey: z.string().optional(),
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

/** Phase 31: what satisfies a blocker. */
export const UnblockWhen = z.enum(["done", "merged"]);
export type UnblockWhen = z.infer<typeof UnblockWhen>;

/** Phase 31: the fields of a card that say what it waits for. */
const CardDeps = {
  blockedBy: z
    .array(z.string())
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  unblockWhen: UnblockWhen.optional(),
  autoStart: z.object({ workflow: z.string().nullable() }).nullable().optional(),
};

/** Issue #1361: why a card's check loop ended; the app names each in its language. */
export const CheckLoopReason = z.enum([
  "passed",
  "rounds_spent",
  "budget",
  "quota",
  "memory",
  "person_turn",
  "stopped_by_you",
  "session_ended",
  "no_result",
  "check_loop_confirm",
  "check_loop_untrusted",
  "check_loop_mode",
  "check_refused",
  "check_error",
  "turn_error",
  "interrupted",
]);
export type CheckLoopReason = z.infer<typeof CheckLoopReason>;

/** Issue #1361: the last line of a card's loop: a round sent, or how the loop ended. */
export const CheckLoopLine = z.object({
  state: z.enum(["sent", "ended"]),
  /** On an end; a reason a newer app does not know reads as `null`. */
  reason: CheckLoopReason.nullable().catch(null),
  /** The failed check's command, masked; `null` when no check failed. */
  command: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  at: z.string(),
});
export type CheckLoopLine = z.infer<typeof CheckLoopLine>;

/** Issue #1361: a card's switch for "keep going until the checks pass", and how its loop goes. */
export const CheckLoopSwitch = z.object({
  on: z.boolean(),
  /** The card's own cap on rounds, below the project's; `null` takes the project's. */
  rounds: z.number().int().min(1).max(10).nullable(),
  /** The person confirmed that the checks run the card's code outside its permission mode. */
  confirmed: z.boolean(),
  /** What the loop does now: its checks run, or a round it sent is being worked on. */
  active: z.enum(["checking", "fixing"]).nullable().optional(),
  /** Rounds sent in the loop going on, and the most it may send. */
  round: z.number().int().min(0).optional(),
  max: z.number().int().min(1).optional(),
  last: CheckLoopLine.nullable().optional(),
});
export type CheckLoopSwitch = z.infer<typeof CheckLoopSwitch>;

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
  /** Issue #1352 (host `prDetails`): merge state, review state and open date, read with the checks. */
  prMergeable: PrMergeable.nullable().optional(),
  prReview: PrReview.nullable().optional(),
  prOpenedAt: z.string().nullable().optional(),
  /** Issue #1405 (host `conflictRadar`): the cards that edit the same files; absent when none. */
  mayConflict: z.array(MayConflict).optional(),
  /** Started and waiting for a free slot. */
  queued: z.boolean(),
  /** Session of the active (latest) run. */
  sessionId: z.string().nullable(),
  sessionStatus: SessionStatus.nullable(),
  /** Last problem worth showing on the card (failed setup, worktree kept on completion). */
  notice: z.string().nullable(),
  /** Why, when the notice came from a refusal: the app translates it, the notice is the fallback. */
  noticeReason: z.string().nullable().optional(),
  noticeParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable()
    .optional(),
  /** Set only on the last update of a discarded card, which leaves the board. */
  discarded: z.boolean(),
  runs: z.array(CardRun),
  /** Workflow run of the active run; `null` for a simple card (phase 4). */
  workflowRunId: z.string().nullable().default(null),
  /** Why a queued card waits: a free slot, or the host's plan quota (phase 7). */
  queueReason: z.enum(["slot", "quota", "memory", "budget", "paused"]).nullable().default(null),
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
      /** Issue #93: the permission mode the variant's session opens in (a team's worker). */
      permissionMode: PermissionMode.nullable().optional(),
    })
    .nullable()
    .default(null),
  /** Phase 13: how many arena variants the card has (0 when it is not in an arena). */
  arenaVariants: z.number().int().nonnegative().default(0),
  /** Phase 13: the issue this card came from (`github:owner/repo#n`, `azure:org/project#id`). */
  issueRef: z.string().nullable().default(null),
  /** Phase 13: the issue's author is third party, so the card's content is untrusted. */
  issueExternal: z.boolean().default(false),
  /** Phase 38: the item of an external board this card follows, and whether it has left that board. */
  externalUrl: z.string().nullable().default(null),
  externalGone: z.boolean().default(false),
  /** Phase 36: the hours this card is worth, an estimate the person typed. */
  estimateHours: z.number().nullable().default(null),
  /** Issue #78: what the person did to validate the work, a note a column can ask for. */
  validationNote: z.string().nullable().default(null),
  /** Issue #1361: the check loop's switch; absent from older daemons. */
  checkLoop: CheckLoopSwitch.optional(),
  /** Issue #78: the spec file the card names in its worktree; `null` is `docs/specs/<slug>.md`. */
  specPath: z.string().nullable().default(null),
  /** Issue #78: what the host last found of the spec file; `null` until it looked. */
  specState: SpecState.nullable().default(null),
  /** Issue #76: the library documents the person pinned to this card, relative paths in order. */
  pinnedDocs: z.array(z.string()).default([]),
  /** Issue #1201: the workflow and the persona the card is meant to start with (a template's); `null`: the default. */
  startWorkflow: z.string().nullable().default(null),
  startPersona: z.string().nullable().default(null),
  /** Phase 31: the cards that must be done first, in the order the person set them. */
  blockedBy: z.array(z.string()).default([]),
  /** Phase 31: the cards this one holds up (the other end of `blockedBy`, never stored twice). */
  blocking: z.array(z.string()).default([]),
  /** Phase 31: the blockers not satisfied yet; empty once the card has started. */
  waitingOn: z.array(z.string()).default([]),
  /** Phase 31: what satisfies a blocker: its card in Done, or its PR merged. */
  unblockWhen: UnblockWhen.default("done"),
  /** Phase 31: start by itself when the last blocker is satisfied (with this workflow, if any). */
  autoStart: z.object({ workflow: z.string().nullable() }).nullable().default(null),
  /** Phase 31: when the last blocker was satisfied and the card did not start by itself. */
  unblockedAt: z.string().nullable().default(null),
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

export const CardDiff = z.object({ base: z.string(), files: z.array(DiffFile) });
export type CardDiff = z.infer<typeof CardDiff>;

/** Issue #1439: a finding of a second-opinion review. */
export const ReviewFinding = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  severity: z.enum(["blocker", "high", "medium", "low"]),
  body: z.string(),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

/** Issue #1439: a card's review: its findings are reviewer drafts; `loose` anchored nowhere. */
export const CardReviewResult = z.object({
  state: z.enum(["done", "failed"]),
  summary: z.string(),
  anchored: z.number().int().nonnegative(),
  loose: z.array(ReviewFinding),
  cached: z.boolean(),
  moved: z.boolean(),
});
export type CardReviewResult = z.infer<typeof CardReviewResult>;

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

/** What `projects.scan` answers: the repositories found, never outside the roots. */
export interface ProjectsScanResult {
  repos: Array<{ name: string; path: string; root: string }>;
  /** The scan stopped at its cap of repositories or of folders visited. */
  truncated: boolean;
}

/** What `projects.clone` answers: the new repository's folder. */
export interface ProjectsCloneResult {
  path: string;
}

/**
 * Issue #1344: what happened on a host since a time, for "While you were away" in Needs you. Each
 * list is the newest `limit` items and its true `total`, so a night of runs never grows the answer.
 */
export interface ActivityList<T> {
  items: T[];
  total: number;
}

export interface ActivitySession {
  id: string;
  name: string | null;
  cwd: string;
  /** When the session ended. */
  at: string;
}

export interface ActivityCard {
  cardId: string;
  projectId: string;
  title: string;
  /** When the card last changed. */
  at: string;
}

export interface ActivityPr extends ActivityCard {
  prUrl: string;
  /** `merged`, or `checks-failed` when the PR is open and its checks fail. */
  outcome: "merged" | "checks-failed";
}

export interface ActivityRun {
  runId: string;
  cardId: string;
  /** The card's project (issue #1408), so the line opens a card the app has not loaded; an older host sends none. */
  projectId?: string;
  workflowName: string;
  /** Why it failed, as a key and params the app translates. */
  reasonKey: string | null;
  reasonParams: Record<string, string | number> | null;
  at: string;
}

export interface ActivitySinceResult {
  since: string;
  sessions: ActivityList<ActivitySession>;
  reviewCards: ActivityList<ActivityCard>;
  prs: ActivityList<ActivityPr>;
  failedRuns: ActivityList<ActivityRun>;
  /** The plan quota windows now, when this host reads them. */
  quota: Array<{ window: string; utilization: number | null }>;
}

/** Phase 38: where a project's board sync stands. `linked: false` carries nothing else. */
export interface BoardSyncStatus {
  linked: boolean;
  provider?: string;
  boardId?: string;
  boardTitle?: string;
  columnMap?: Partial<Record<string, BoardColumn>>;
  /** Local moves are sent to the board. */
  push?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  pausedUntil?: string | null;
  /** The board has more items than one pull reads. */
  truncated?: boolean;
  /** The board's Status options, for the map editor. */
  statusOptions?: string[];
}

/** One board of the external provider. */
export interface BoardSyncBoard {
  id: string;
  title: string;
  owner: string;
  number: number;
  url: string;
}

/** What one sync did. */
export interface BoardSyncReport {
  created: number;
  moved: number;
  updated: number;
  conflicts: number;
  unmapped: number;
  gone: number;
  skipped: number;
  pushed: number;
  redacted: number;
  truncated: boolean;
  notModified: boolean;
}

/** One line of a card's sync log: a conflict, a skipped move, a push that failed. */
export interface BoardSyncLogEntry {
  at: string;
  kind: string;
  winner: "local" | "external" | null;
  lostValue: string | null;
  lostAt: string | null;
  keptValue: string | null;
  keptAt: string | null;
  detail: string | null;
}

/** Phase 37: whether the host's `gh` is signed in to GitHub. Never a token. */
export interface GithubStatusResult {
  installed: boolean;
  loggedIn: boolean;
  login: string | null;
  scopes: string[];
  /** Where `gh` keeps the login. */
  source: "keyring" | "file" | "env" | null;
}

/** The device flow's one-time code and the page where it is typed. */
export interface GithubLoginResult {
  code: string;
  url: string;
}

export interface GithubRepoItem {
  /** `owner/name`. */
  name: string;
  description: string;
  private: boolean;
  url: string;
  updatedAt: string;
}

export interface GithubStartResult {
  projectId: string;
  path: string;
  cardId?: string;
  sessionId?: string;
  /** The folder was already a clone of the repo. */
  reused: boolean;
}

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
  /** The same problems as codes with params, for the app to translate. */
  issues: z
    .array(
      z.object({
        path: z.string(),
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
  inputs: z.array(z.string()),
});
export type WorkflowInfo = z.infer<typeof WorkflowInfo>;

/**
 * Issue #79: a workflow that ships with the product, to copy into `.flightdeck/workflows/` and
 * commit to the base branch (the host never writes there; trust stays on the Workflows screen).
 */
export const WorkflowTemplate = z.object({
  id: z.string(),
  title: LocalizedText,
  description: LocalizedText,
  /** What bounds a run: rounds, budget, cards, where it stops for approval. */
  limits: LocalizedText,
  /** The persona the template's agent steps run in. */
  persona: z.string(),
  inputs: z.array(z.string()),
  /** Where to commit the file, relative to the repository. */
  path: z.string(),
  yaml: z.string(),
  /** The `check` line: true when it holds the project's own test command, false when it holds a placeholder that fails, null when the template has none. */
  checkFilled: z.boolean().nullable(),
});
export type WorkflowTemplate = z.infer<typeof WorkflowTemplate>;

/** Issue #1221: where the template went: its file, the new branch, the base the PR targets, the PR. */
export const WorkflowTemplateAdded = z.object({
  path: z.string(),
  branch: z.string(),
  base: z.string(),
  url: z.string(),
});
export type WorkflowTemplateAdded = z.infer<typeof WorkflowTemplateAdded>;

/**
 * Issue #79: an open alert of the project's repository, read by the host with `gh` (code scanning
 * or Dependabot). `text` is what goes into a workflow's `alert` input: the alert's own words, which
 * come from a scanner or an advisory and are data, never instructions.
 */
export const RepoAlert = z.object({
  /** `<kind>:<number>`, unique in the list. */
  id: z.string(),
  kind: z.enum(["code-scanning", "dependabot"]),
  number: z.number().int(),
  severity: z.enum(["critical", "high", "medium", "low", "unknown"]),
  title: z.string(),
  /** `path:line` for code scanning, the manifest for Dependabot. */
  location: z.string().nullable(),
  /** The alert's page on GitHub; empty when it was not an https link. */
  url: z.string(),
  text: z.string(),
});
export type RepoAlert = z.infer<typeof RepoAlert>;

/** Why a source of alerts could not be read, said without `gh`'s own text. */
export const AlertsUnavailable = z.object({
  kind: z.enum(["code-scanning", "dependabot"]),
  reason: z.enum(["gh_missing", "not_signed_in", "unavailable", "failed"]),
});
export type AlertsUnavailable = z.infer<typeof AlertsUnavailable>;

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

export const StepType = z.enum(["agent", "check", "gate", "loop", "parallel", "pr", "cards"]);
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
  /** Why, when the run ended on a refusal: the app translates it, `statusReason` is the fallback. */
  reasonKey: z.string().nullable().optional(),
  reasonParams: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable()
    .optional(),
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

/** One step of a prompt in a session's timeline (phase 23). */
export const TelemetryItem = z.object({
  kind: z.enum(["tool", "permission", "api", "error"]),
  /** Epoch ms. */
  at: z.number(),
  toolName: z.string().nullable(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  success: z.boolean().nullable(),
  /** The tool's `error_type` or the HTTP status of an API error. */
  error: z.string().nullable(),
  /** `accept` or `reject`, for a permission. */
  decision: z.string().nullable(),
  /** Who decided: `config`, `hook`, `user_temporary`... */
  source: z.string().nullable(),
  /** For a permission a person answered: the time from the step before it to the answer. */
  waitMs: z.number().nullable(),
});
export type TelemetryItem = z.infer<typeof TelemetryItem>;

export const TelemetryPrompt = z.object({
  /** `null` for events that carry no prompt id. */
  promptId: z.string().nullable(),
  startedAt: z.number(),
  endedAt: z.number(),
  costUsd: z.number(),
  /** Sum of the permission waits of the prompt. */
  waitMs: z.number(),
  items: z.array(TelemetryItem),
});
export type TelemetryPrompt = z.infer<typeof TelemetryPrompt>;

export const TelemetrySession = z.object({ prompts: z.array(TelemetryPrompt) });
export type TelemetrySession = z.infer<typeof TelemetrySession>;

export const SlowTool = z.object({
  toolName: z.string(),
  calls: z.number().int(),
  avgMs: z.number(),
  maxMs: z.number(),
});
export type SlowTool = z.infer<typeof SlowTool>;

/** Per project: the time spent waiting for a person's permission and the slowest tools. */
export const TelemetrySummary = z.object({
  projects: z.array(
    z.object({ projectKey: z.string(), waitMs: z.number(), slowest: z.array(SlowTool) }),
  ),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummary>;

const BgId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "invalid background session id");

/** Phase 27: a Claude Code background session (`claude --bg`), as `claude agents --json` lists it. */
export const BgSession = z.object({
  /** The short id `claude attach`, `logs` and `stop` take. */
  id: z.string(),
  name: z.string().nullable(),
  cwd: z.string(),
  /** `working`, `blocked`, `done`, `failed` or `stopped`; anything newer is kept as it is. */
  state: z.string(),
  /** While its process is alive: `busy`, `waiting` or `idle`. */
  status: z.string().nullable(),
  /** What a waiting session waits for: `permission prompt`, `input needed`... */
  waitingFor: z.string().nullable(),
  pid: z.number().int().nullable(),
  /** The Claude Code session id, for `--resume`, the transcript and the cost. */
  claudeSessionId: z.string().nullable(),
  /** Unix ms. */
  startedAt: z.number().nullable(),
  /** From the usage of the transcripts (phase 8); `null` when there is none. */
  costUsd: z.number().nullable(),
});
export type BgSession = z.infer<typeof BgSession>;

export const BgList = z.object({
  /** `false` when this host's `claude` has no background sessions (an older one, or none). */
  supported: z.boolean(),
  sessions: z.array(BgSession),
});
export type BgList = z.infer<typeof BgList>;

/** Phase 25: a node of a session's trace: a turn, a tool call, a subagent or a thought. */
export interface TraceNode {
  /** Stable inside a trace: `turn:2`, `tool:<tool_use_id>`, `agent:<id>`, `thought:<uuid>`. */
  id: string;
  kind: "turn" | "tool" | "subagent" | "thinking";
  /** The tool, the subagent type, or `turn`/`thinking`. */
  name: string;
  /** For a turn, 1, 2, 3...: the number the checkpoints of phase 12 use. */
  n: number | null;
  /** The prompt of a turn, or the description of a subagent; text the export leaves out. */
  label: string | null;
  /** The tool's input and result, summarised; text the export leaves out. */
  input: string | null;
  result: string | null;
  /** Epoch ms of the start; `null` when the transcript line has no timestamp. */
  startMs: number | null;
  durationMs: number | null;
  /** The messages' cost under this node, subagents included; `null` when none is priced. */
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  error: boolean;
  children: TraceNode[];
}

export const TraceNode: z.ZodType<TraceNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["turn", "tool", "subagent", "thinking"]),
    name: z.string(),
    n: z.number().int().nullable(),
    label: z.string().nullable(),
    input: z.string().nullable(),
    result: z.string().nullable(),
    startMs: z.number().nullable(),
    durationMs: z.number().nullable(),
    costUsd: z.number().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    error: z.boolean(),
    children: z.array(TraceNode),
  }),
);

export const SessionTrace = z.object({
  claudeSessionId: z.string(),
  turns: z.array(TraceNode),
  costUsd: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** The turn or subagent that cost most, and the tool call or subagent that took longest. */
  costliest: z.string().nullable(),
  slowest: z.string().nullable(),
});
export type SessionTrace = z.infer<typeof SessionTrace>;

/** Phase 30: a short summary of a session, built from its transcript with no model call. */
export const SessionRecap = z.object({
  asked: z.string().nullable(),
  done: z.string().nullable(),
  files: z.array(z.string()),
  /** Files touched beyond the ones listed. */
  filesMore: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  /** The pending permission or question, when the caller says there is one. */
  question: z.string().nullable(),
  state: z.string(),
  source: z.literal("transcript"),
});
export type SessionRecap = z.infer<typeof SessionRecap>;

/** The trace as a file to attach to a bug: structure and numbers, content only when asked. */
export const TraceExport = z.object({
  filename: z.string(),
  json: z.string(),
  /** Fields of the content that were replaced because a secret was found in them. */
  redacted: z.number().int(),
});
export type TraceExport = z.infer<typeof TraceExport>;

/** Phase 23: whether Flightdeck's exporter keys are in the user's settings.json. */
export const TelemetryOptInStatus = z.object({
  /** `conflict`: settings.json already has an exporter of the user's, so install would refuse. */
  status: z.enum(["installed", "absent", "outdated", "conflict"]),
  /** The settings.json the keys go to. */
  settingsPath: z.string(),
  /** The receiver the keys point at; `null` when no fixed port is set. */
  receiverUrl: z.string().nullable(),
  /** The user's own keys that block an install. */
  conflicts: z.array(z.string()),
});
export type TelemetryOptInStatus = z.infer<typeof TelemetryOptInStatus>;

const ProjectFields = {
  name: z.string().min(1).optional(),
  /** A branch name git accepts, and never one that starts with `-` (issue #345). */
  baseBranch: z.string().refine(isBranchName, "not a valid branch name").optional(),
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
  /** Issue #78: `null` gives a column back to the default contract. */
  contractByColumn: z.partialRecord(BoardColumn, ColumnContract.nullable()).optional(),
  personaSubagents: PersonaSubagentsMode.optional(),
  /** Phase 36: `null` removes the default. */
  defaultHours: z.number().min(0).max(1000).nullable().optional(),
  /** Phase 36: which optional value signals are on; a field left out keeps its value. */
  roiSignals: z
    .object({ commits: z.boolean().optional(), issues: z.boolean().optional() })
    .strict()
    .optional(),
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
/** #1266: whether a failed run can resume, from which step, and the reason when it cannot. */
export const RunResumeCheck = z.object({
  from: z.string(),
  ok: z.boolean(),
  reason: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
});
export type RunResumeCheck = z.infer<typeof RunResumeCheck>;

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
  /** #935: the mode its hooks last reported (Shift+Tab in the terminal included); absent until one does. */
  permissionMode: PermissionMode.optional(),
});
export type ExternalSession = z.infer<typeof ExternalSession>;

// ---------------------------------------------------------------------------
// Phase 21: messages between sessions, and teams
// ---------------------------------------------------------------------------

/**
 * Phase 22: a local check of the PR watch runs unattended after a fixing round, so it is a command
 * and its arguments separated by spaces, with nothing a shell would read: no quotes, pipes,
 * redirections, substitutions, variables, globs or line breaks.
 */
export const isWatchCheck = (line: string): boolean =>
  /^[\w@+=:,./-]+(?: [\w@+=:,./-]+)*$/.test(line);

/**
 * Issue #1361: the names a project may add to its checks' environment: where a toolchain lives
 * (`JAVA_HOME`, `ANDROID_SDK_ROOT`, `GOPATH`), never a variable that runs or redirects code. An
 * allowlist: a blocklist of the variables that steer code (`GIT_SSH_COMMAND`, `JAVA_TOOL_OPTIONS`,
 * `npm_config_*`, `RUSTC_WRAPPER`, …) would never be complete.
 */
const TOOLCHAIN_ENV =
  /^(?:[A-Z][A-Z0-9_]*_(?:HOME|ROOT)|GOPATH|GOROOT|GOCACHE|GOMODCACHE|BUN_INSTALL|NVM_DIR|DENO_DIR|PUB_CACHE|ProgramFiles\(x86\)|CommonProgramFiles(?:\(x86\))?)$/i;

/**
 * Issue #1361: refused even when shaped like a location: a secret's name (connection strings, key
 * files, tokens), Flightdeck's own, git's and npm's, or a loader's. Over-blocking is fine: a check
 * that needs a secret does not run unattended. Any case (Windows reads both).
 */
const REFUSED_ENV = [
  /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|JWT/i,
  /BEARER|SAS|SIGNATURE|WEBHOOK|DSN|DATABASE_URL|CONN|PRIVATE|CERT/i,
  // Today no name that passes TOOLCHAIN_ENV ends this way; kept, as the one pattern had them.
  /_PASS$|^PWD$|_PAT$/i,
  /^(?:ANTHROPIC|CLAUDE|OPENAI|AWS|AZURE|GH|GITHUB|FLIGHTDECK|GIT|NPM|LD|DYLD|XDG)_/i,
];

/** Issue #1361: a name a project may add to its checks' environment (the value stays the daemon's). */
export const isCheckEnvName = (name: string): boolean =>
  TOOLCHAIN_ENV.test(name) && !REFUSED_ENV.some((refused) => refused.test(name));

/** Phase 22: how a card's PR is watched and fixed, per project. */
export const WatchSettings = z.object({
  enabled: z.boolean(),
  /** Rounds of fixing per PR. */
  maxRounds: z.number().int().min(1).max(10),
  /** Commands that must pass in the card's worktree before anything is pushed. */
  checks: z
    .array(
      z
        .string()
        .min(1)
        .max(400)
        .refine(isWatchCheck, "a check is a command and its arguments, with nothing a shell reads"),
    )
    .max(10),
  /** Minutes each local check gets before it is killed. */
  checkTimeoutMin: z.number().int().min(1).max(60),
  /** Estimated cost of the rounds of a PR, in US$; `null` for no limit. */
  budgetUsd: z.number().positive().nullable(),
  maxTurns: z.number().int().positive().nullable(),
  persona: z.string().min(1).max(40),
  /** Rounds in a row that fail before the card asks for you. */
  maxFailures: z.number().int().min(1).max(10),
  /** Cost of every round of the project in a day, in US$; `null` for no limit. */
  dailyUsd: z.number().positive().nullable(),
  /** Issue #1361: rounds of the check loop per turn of the person; absent from older daemons. */
  checkRounds: z.number().int().min(1).max(10).optional(),
  /** Issue #1361: names added to the checks' allowlisted environment. */
  checkEnv: z
    .array(
      z.string().max(64).refine(isCheckEnvName, "a variable name, not one shaped like a secret"),
    )
    .max(20)
    .optional(),
  /** Issue #1361: new cards in bypassPermissions start with the check loop on. */
  checkLoopDefault: z.boolean().optional(),
  /** Issue #77: globs of files a round may change outside its PR (lockfiles); absent from older daemons. */
  driftAllow: z
    .array(
      z
        .string()
        .min(1)
        .max(200)
        .regex(/^[^\p{Cc}]+$/u, "a glob has no control characters"),
    )
    .max(50)
    .optional(),
});
export type WatchSettings = z.infer<typeof WatchSettings>;

export const FixRoundInfo = z.object({
  id: z.string(),
  cardId: z.string(),
  n: z.number().int(),
  /** `held`: the round drifted from its PR (#77): its commits wait for you to push or drop them. */
  status: z.enum(["running", "pushed", "failed", "stopped", "held"]),
  trigger: z.object({
    failed: z.array(z.string()),
    conflicts: z.boolean(),
    comments: z.array(z.string()),
  }),
  summary: z.string().nullable(),
  sessionId: z.string().nullable(),
  costUsd: z.number(),
  turns: z.number().int(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** A held round's files outside the PR and its churn against the limit (#77). */
  drift: z
    .object({ outside: z.array(z.string()), churn: z.number().int(), limit: z.number().int() })
    .nullable()
    .optional(),
});
export type FixRoundInfo = z.infer<typeof FixRoundInfo>;

/** What the app shows of a card's watch. */
export const WatchInfo = z.object({
  cardId: z.string(),
  enabled: z.boolean(),
  /** `needs_you`: a limit was hit or a round failed for good; `reason` says which. */
  status: z.enum(["watching", "needs_you"]),
  reason: z.string().nullable(),
  rounds: z.array(FixRoundInfo),
  /** Issue #77: the rounds that count against the limit, and the limit with the rounds allowed on top. Absent from older daemons. */
  roundsUsed: z.number().int().min(0).optional(),
  maxRounds: z.number().int().min(1).optional(),
});
export type WatchInfo = z.infer<typeof WatchInfo>;

export const WatchUpdatedFrame = z.object({ type: z.literal("watch.updated"), watch: WatchInfo });
export type WatchUpdatedFrame = z.infer<typeof WatchUpdatedFrame>;

export const TraceSessionInfo = z.object({
  sessionId: z.string(),
  claudeSessionId: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum(["run", "fix"]),
  startedAt: z.string(),
  costUsd: z.number().nullable(),
  checkpoints: z.number().int(),
});

/** The trail from a card and its PR to its sessions, cost, rounds and work item. */
export const CardTraceInfo = z.object({
  cardId: z.string(),
  title: z.string(),
  prUrl: z.string().nullable(),
  workItem: z.string().nullable(),
  sessions: z.array(TraceSessionInfo),
  rounds: z.array(FixRoundInfo),
  costUsd: z.number().nullable(),
});
export type CardTraceInfo = z.infer<typeof CardTraceInfo>;

export const UrlTraceInfo = z.object({
  via: z.enum(["card", "history", "none"]),
  trace: CardTraceInfo.nullable(),
  sessions: z.array(
    z.object({ claudeSessionId: z.string(), title: z.string().nullable(), cwd: z.string() }),
  ),
});
export type UrlTraceInfo = z.infer<typeof UrlTraceInfo>;

const harnessDigests = z
  .record(z.string().max(256), z.string().max(128))
  .refine((digests) => Object.keys(digests).length <= HARNESS_DIGESTS_MAX);

export const Command = z.discriminatedUnion("type", [
  cmd("hello", HelloPayload),
  cmd("session.list", SessionListPayload),
  cmd("session.create", SessionCreatePayload),
  cmd("session.send", SessionSendPayload),
  cmd("session.interrupt", SessionIdPayload),
  /** Changes the permission mode of a live managed session for its next tool requests. */
  cmd(
    "session.setMode",
    z
      .object({
        sessionId: z.string(),
        permissionMode: SettableMode,
      })
      .strict(),
  ),
  /** Changes the model of a live managed session for its next turn; null is the default. */
  cmd(
    "session.setModel",
    z.object({ sessionId: z.string(), model: z.string().nullable() }).strict(),
  ),
  /** Changes the effort of a live managed session for its next turn; null is the model's default. */
  cmd(
    "session.setEffort",
    z.object({ sessionId: z.string(), effort: EffortLevel.nullable() }).strict(),
  ),
  cmd("session.close", SessionIdPayload),
  /** Issue #157: ends the process of an idle session now; the next message wakes it. */
  cmd("session.sleep", SessionIdPayload),
  cmd("session.resume", SessionIdPayload),
  /** The sessions a daemon restart interrupted in the last 24 hours, for the resume offer (issue #150). */
  cmd("session.interrupted", z.object({}).strict()),
  cmd("session.subscribe", SessionSubscribePayload),
  cmd("session.unsubscribe", SessionIdPayload),
  /**
   * `snapshot: "ack"` (#1191, feature `watch.snapshot`): the current summaries come in the ack, one
   * frame for them all, not one frame each.
   */
  cmd("sessions.watch", z.object({ snapshot: z.literal("ack").optional() }).strict()),
  cmd("history.list", HistoryListPayload),
  cmd("history.get", HistoryGetPayload),
  cmd("history.tool", HistoryToolPayload),
  cmd("history.search", HistorySearchPayload),
  cmd("history.resume", HistoryResumePayload),
  cmd("history.watch", z.object({}).strict()),
  cmd("project.list", z.object({}).strict()),
  cmd("project.add", ProjectAddPayload),
  cmd("project.update", ProjectUpdatePayload),
  /**
   * Issue #1568 (host `prDetect`): when the project has no PR provider, reads its `origin` remote and
   * sets GitHub or Azure DevOps from it. Never returns the remote's address, only its host name.
   */
  cmd("project.detectProvider", z.object({ projectId: z.string() }).strict()),
  /** Issue #196: which folders may bring their own hooks, MCP servers and settings into a managed session. */
  cmd(
    "project.trust.state",
    z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }).strict(),
  ),
  cmd("project.trust.inspect", z.object({ path: z.string().min(1).max(4096) }).strict()),
  /** #75: the project's stack and its test, lint, format and build commands, read, never run. */
  cmd("project.harness.stack", z.object({ path: z.string().min(1).max(4096) }).strict()),
  cmd(
    "project.harness.preview",
    z
      .object({
        path: z.string().min(1).max(4096),
        parts: z.array(z.enum(HARNESS_PREVIEW_PARTS)).min(1).max(HARNESS_PREVIEW_PARTS.length),
        /** #75, slice T1b: a host template's Markdown instead of the fixed files. */
        template: z.string().regex(HARNESS_TEMPLATE_ID).optional(),
      })
      .strict(),
  ),
  /**
   * #75, slice T1: shares the project's Markdown harness (CLAUDE.md, agents, skills; never settings)
   * as a host template `id`: read without a link, scanned for secrets, written all or nothing.
   */
  cmd(
    "project.harness.export",
    z
      .object({
        path: z.string().min(1).max(4096),
        id: z.string().min(1).max(40),
        // Shown in every client's list: words, not blank, no control character or line break.
        title: z
          .string()
          .min(1)
          .max(80)
          .refine((title) => title.trim() !== "" && !/\p{Cc}/u.test(title)),
      })
      .strict(),
  ),
  /**
   * #75, slice G1: drafts a CLAUDE.md with the host's model from the detected stack and the
   * project's top-level names (never a file's content). The host holds the draft; an apply whose
   * digest for CLAUDE.md is the draft's writes it. Never hooks or permissions from a model.
   */
  cmd(
    "project.harness.draft",
    z.object({ path: z.string().min(1).max(4096), part: z.literal("claudeMd") }).strict(),
  ),
  /**
   * #75, slice C1: commits what `project.harness.apply` wrote (by its `digests`) on a new branch the
   * host names, through a temporary index: the person's branch, index and files stay as they are.
   */
  cmd(
    "project.harness.commit",
    z
      .object({
        path: z.string().min(1).max(4096),
        digests: harnessDigests,
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  /**
   * #75, slice S4: writes what the preview proposed. The daemon makes the proposals again and never
   * takes content from the app; `digests` (each proposal's, by path) must match them all, else
   * `harness_stale`. Writing hooks lets commands run in sessions: a near connection and `confirm`.
   */
  cmd(
    "project.harness.apply",
    z
      .object({
        path: z.string().min(1).max(4096),
        parts: z.array(z.enum(HARNESS_PREVIEW_PARTS)).min(1).max(HARNESS_PREVIEW_PARTS.length),
        digests: harnessDigests,
        confirm: z.boolean().optional(),
        /** The person accepted the settings being rewritten with another layout (the preview's `reformats`). */
        reformat: z.boolean().optional(),
        /** #75, slice T1b: a host template's Markdown instead of the fixed files. */
        template: z.string().regex(HARNESS_TEMPLATE_ID).optional(),
      })
      .strict(),
  ),
  cmd(
    "project.trust.set",
    z.object({ path: z.string().min(1).max(4096), trusted: z.boolean() }).strict(),
  ),
  cmd("board.get", z.object({ projectId: z.string() })),
  /** Host-wide board settings; without fields it only reads them. */
  cmd("board.settings", z.object({ maxParallelRuns: z.number().int().min(1).optional() })),
  cmd("board.watch", z.object({}).strict()),
  cmd(
    "card.create",
    z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: z.string(),
      /** The column the card is born in; the Backlog when absent (an older daemon ignores it). */
      column: BoardColumn.optional(),
      /** Issue #1201: a card template of the project; the host fills the card from it. */
      templateId: z.string().min(1).max(60).optional(),
      ...CardDeps,
    }),
  ),
  cmd("card.templates", z.object({ projectId: z.string() })),
  /**
   * Issue #1361: turns the card's check loop on or off. Outside bypassPermissions it turns on only
   * with `confirm`, which needs a near connection; off always works.
   */
  cmd(
    "card.checkLoop",
    z
      .object({
        cardId: z.string().min(1),
        on: z.boolean(),
        confirm: z.boolean().optional(),
        rounds: z.number().int().min(1).max(10).nullable().optional(),
      })
      .strict(),
  ),
  cmd(
    "card.update",
    z.object({
      cardId: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      /** Phase 36: `null` removes the estimate. */
      estimateHours: z.number().min(0).max(1000).nullable().optional(),
      /** Issue #78: the validation note; empty text or `null` clears it. */
      validationNote: z.string().max(4000).nullable().optional(),
      /** Issue #78: the spec file in the worktree, relative; `null` goes back to the default. */
      specPath: z
        .string()
        .max(SPEC_PATH_MAX)
        .refine((path) => specPathProblem(path) === null)
        .nullable()
        .optional(),
      /** Issue #76: the library documents pinned to the card; replaces the whole list. */
      pinnedDocs: z
        .array(
          z
            .string()
            .max(SPEC_PATH_MAX)
            .refine((path) => pinnedDocProblem(path) === null),
        )
        .max(PINNED_DOCS_MAX)
        .optional(),
      ...CardDeps,
    }),
  ),
  cmd(
    "card.move",
    z.object({
      cardId: z.string(),
      column: BoardColumn,
      position: z.number().optional(),
      /** Issue #78: move although the column's contract is not met; the card keeps a notice. */
      force: z.boolean().optional(),
    }),
  ),
  cmd("card.start", CardStartPayload),
  cmd("card.get", CardIdPayload),
  /** Issue #78: looks at the card's spec file again and answers the card. */
  cmd("card.spec", CardIdPayload),
  /** Issue #1058: the project's own shape for a validation note, or why it was not used. */
  cmd("card.validationTemplate", CardIdPayload),
  cmd("card.stop", CardIdPayload),
  cmd("card.diff", CardIdPayload),
  /** Issue #1439: a second-opinion review of the card's diff; near only. */
  cmd(
    "card.review",
    z.object({ cardId: z.string(), language: z.enum(["en", "pt-BR"]).optional() }).strict(),
  ),
  /** Phase 40: the AI assistant (feature `assistant`). */
  cmd("assistant.run", AssistantRunPayload),
  cmd("assistant.cancel", AssistantCancelPayload),
  cmd("assistant.context", AssistantContextPayload),
  cmd("assistant.record", AssistantRecordPayload),
  cmd("card.message", z.object({ cardId: z.string(), text: z.string().min(1) })),
  /** With `description`: the text the person confirmed for the PR, instead of the card's own. */
  cmd(
    "card.pr.create",
    z.object({
      cardId: z.string(),
      description: z.string().max(8000).optional(),
      /** Phase 40: the title the person confirmed, instead of the card's own. */
      title: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[^\r\n]*$/)
        .optional(),
    }),
  ),
  /**
   * A session managing the cards of its own project through the flightdeck MCP server. The daemon
   * finds the session's project (and its own card) from where it runs; `cardId` defaults to that card.
   */
  cmd(
    "card.manage",
    z.object({
      as: SessionIdentity,
      /** The folder a terminal session runs in; a managed session's own folder wins. */
      cwd: z.string().optional(),
      action: z.enum(["move", "update", "comment", "finish"]),
      cardId: z.string().optional(),
      column: BoardColumn.optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      text: z.string().min(1).optional(),
      outcome: z.enum(["done", "discard"]).optional(),
    }),
  ),
  /**
   * #1196: merges the card's open PR on its provider (`gh pr merge`, a merge commit or a squash);
   * a near connection and `confirm`. The card then moves to Done as any merged PR does.
   */
  cmd(
    "card.pr.merge",
    z
      .object({
        cardId: z.string(),
        method: z.enum(["merge", "squash"]),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  cmd("card.complete", CardConfirmPayload),
  cmd("card.discard", CardConfirmPayload),
  /** Removes a card that never started; a started one is refused (use `card.discard`). */
  cmd("card.delete", CardConfirmPayload),
  cmd("card.dismissUnblocked", CardIdPayload),
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
  /** Issue #152: the worktrees of the cards, with their size, state and why one is kept. */
  cmd("worktree.list", z.object({ projectId: z.string().optional() }).strict()),
  /** Removes the listed worktrees that are safe to remove; the daemon checks each one again. */
  cmd(
    "worktree.remove",
    z.object({
      items: z.array(z.object({ projectId: z.string(), path: z.string() }).strict()).min(1),
      /** Like Discard and Delete: the host asks for the person's yes in the request itself. */
      confirm: z.literal(true),
    }),
  ),
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
  /** The standard names of this host's sessions: the app's list and palette address by alias. */
  cmd("names.list", z.object({}).strict()),
  /** Phase 22: the PR watch of a project (the settings) and of a card (the switch, the rounds). */
  cmd(
    "watch.settings",
    z.object({ projectId: z.string().min(1), patch: WatchSettings.partial().strict().optional() }),
  ),
  cmd("watch.set", z.object({ cardId: z.string().min(1), enabled: z.boolean().nullable() })),
  cmd("watch.get", z.object({ cardId: z.string().min(1) })),
  // Issue #77: the person allows a card N more fixing rounds; the card is watched again.
  cmd(
    "watch.extend",
    z.object({ cardId: z.string().min(1), rounds: z.number().int().min(1).max(10) }).strict(),
  ),
  // Issue #77: the person pushes a held round as it is, or drops its commits.
  cmd(
    "watch.resolveHeld",
    z
      .object({
        cardId: z.string().min(1),
        roundId: z.string().min(1),
        action: z.enum(["push", "drop"]),
      })
      .strict(),
  ),
  cmd("watch.trace", z.object({ cardId: z.string().min(1) })),
  /** The PR description made from the card's sessions, for the person to edit: nothing is opened. */
  cmd("watch.describe", z.object({ cardId: z.string().min(1) })),
  cmd("watch.byUrl", z.object({ url: z.string().min(1).max(2000) })),
  cmd("watch.watch", z.object({}).strict()),
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
  cmd("hooks.status", z.object({}).strict()),
  /** Writes to the host user's ~/.claude/settings.json: only with `confirm: true`. */
  cmd("hooks.install", z.object({ confirm: z.boolean().optional() })),
  cmd("hooks.uninstall", z.object({ confirm: z.boolean().optional() })),
  cmd("external.message", z.object({ claudeSessionId: z.string(), text: z.string().min(1) })),
  // Phase 6: workflows of a project (read from its base branch) and their runs.
  cmd("workflow.list", z.object({ projectId: z.string() })),
  /** Issue #79: the workflow templates, with the check line filled from the project's stack. */
  cmd("workflow.templates", z.object({ projectId: z.string() })),
  /**
   * Issue #1221: the host commits one of its own templates (by id; the app sends no file and no
   * path) on a new branch of the project and opens its PR, as a card does. Never the base branch:
   * the file is listed, untrusted, once the PR is merged. Refused without `confirm: true`.
   */
  cmd(
    "workflow.template.add",
    z
      .object({
        projectId: z.string(),
        templateId: z.string().min(1).max(200),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  /** Issue #79: the open code-scanning and Dependabot alerts of the project's repository, read-only. */
  cmd("alert.list", z.object({ projectId: z.string() })),
  cmd("workflow.validate", z.object({ projectId: z.string(), name: z.string().min(1) })),
  /** `hash` is the content the user reviewed; a workflow that changed since is refused. */
  cmd(
    "workflow.trust",
    z.object({ projectId: z.string(), name: z.string().min(1), hash: z.string().min(1) }),
  ),
  // Phase 24: the run environment of a card (scripts, a block of ports, a preview).
  cmd("runenv.config", z.object({ projectId: z.string() })),
  /** `hash` is the run.yaml the user reviewed; one that changed since is refused. */
  cmd("runenv.trust", z.object({ projectId: z.string(), hash: z.string().min(1) })),
  cmd("runenv.start", z.object({ cardId: z.string() })),
  cmd("runenv.stop", z.object({ cardId: z.string() })),
  cmd("runenv.get", z.object({ cardId: z.string() })),
  cmd("runenv.watch", z.object({}).strict()),
  cmd("run.get", z.object({ runId: z.string() })),
  cmd("run.watch", z.object({}).strict()),
  /**
   * #1266: whether a failed run can resume from its failed step (`from`), and why not; with
   * `confirm`, resumes it (near only: it runs the project's commands again).
   */
  cmd(
    "run.resume",
    z.object({ runId: z.string().min(1), confirm: z.boolean().optional() }).strict(),
  ),
  /** Only the user answers gates: there is no MCP tool for it. */
  cmd("gate.respond", GateRespondPayload),
  // Phase 23: the timing of a terminal session, from Claude Code's OTLP telemetry.
  cmd("telemetry.session", z.object({ claudeSessionId: z.string() })),
  cmd("telemetry.summary", z.object({}).strict()),
  // The opt-in for a plain `claude`: Flightdeck's keys in the user's ~/.claude/settings.json.
  // Phase 27: Claude Code's background sessions.
  cmd("bg.list", z.object({}).strict()),
  cmd("bg.stop", z.object({ id: BgId })),
  cmd("bg.respawn", z.object({ id: BgId })),
  cmd("bg.message", z.object({ id: BgId, text: z.string().min(1).max(32_000) })),
  cmd(
    "bg.start",
    z
      .object({
        /** A folder and a prompt, or a card (its project's folder and its text). */
        cwd: z.string().min(1).optional(),
        prompt: z.string().min(1).max(32_000).optional(),
        cardId: z.string().min(1).optional(),
        name: z.string().min(1).max(120).optional(),
        persona: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "invalid persona id")
          .optional(),
      })
      .refine((p) => p.cardId !== undefined || (p.cwd !== undefined && p.prompt !== undefined), {
        message: "bg.start needs cwd and prompt, or a card",
      }),
  ),
  cmd("telemetry.status", z.object({}).strict()),
  // Phase 25: the trace of a session, built from its transcript and its subagents'.
  cmd("trace.get", z.object({ claudeSessionId: z.string().min(1) })),
  /** Phase 30: `question` and `state` are what the caller knows (the pending request, the session state). */
  cmd(
    "session.summary",
    z
      .object({
        claudeSessionId: z.string().min(1),
        question: z.string().optional(),
        state: z.string().optional(),
      })
      .strict(),
  ),
  cmd(
    "trace.export",
    z.object({ claudeSessionId: z.string().min(1), includeContent: z.boolean().optional() }),
  ),
  cmd("telemetry.install", z.object({ confirm: z.boolean().optional() })),
  cmd("telemetry.uninstall", z.object({ confirm: z.boolean().optional() })),
  cmd("changes.get", z.object({ target: ReviewTarget })),
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
        message: "give sessionId or claudeSessionId, one of the two",
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
        message: "give sessionId or claudeSessionId, one of the two",
      }),
  ),
  cmd("pr.comments", CardIdPayload),
  /** The sessions that wrote a file, by its absolute path. */
  cmd("files.sessions", z.object({ path: z.string().min(1) })),
  cmd("session.files", z.object({ claudeSessionId: z.string() })),
  /** Git repositories inside the allowed roots (bounded depth and count), for "find my projects". */
  cmd("projects.scan", z.object({ depth: z.number().int().min(1).max(3).optional() }).strict()),
  /** Phase 37: the host's gh login (device flow), the person's repos and issues, and start from them. */
  cmd("github.status", z.object({}).strict()),
  cmd("github.login.start", z.object({}).strict()),
  cmd("github.login.cancel", z.object({}).strict()),
  cmd("github.logout", z.object({}).strict()),
  cmd("github.repos", z.object({ query: z.string().max(100).optional() }).strict()),
  cmd("github.issues", z.object({ repo: z.string().min(1).max(200) }).strict()),
  cmd(
    "github.start",
    z
      .object({
        repo: z.string().min(1).max(200),
        issue: z.string().min(1).max(20).optional(),
        root: z.string().min(1),
        mode: z.enum(["card", "session"]),
      })
      .strict(),
  ),
  /** Issue #1344: what finished, reached review, merged or failed on this host since a time; read-only and capped. */
  cmd(
    "activity.since",
    z
      .object({
        since: z.string().datetime(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  ),
  /** Phase 38: board sync with an external board (GitHub Projects first). */
  cmd("boardsync.boards", z.object({}).strict()),
  cmd(
    "boardsync.link",
    z
      .object({
        projectId: z.string().min(1),
        boardId: z.string().min(1).max(200),
        columnMap: z.record(z.string().min(1).max(200), BoardColumn).optional(),
      })
      .strict(),
  ),
  cmd("boardsync.unlink", z.object({ projectId: z.string().min(1) }).strict()),
  cmd(
    "boardsync.setMap",
    z
      .object({
        projectId: z.string().min(1),
        columnMap: z.record(z.string().min(1).max(200), BoardColumn),
      })
      .strict(),
  ),
  cmd(
    "boardsync.setPush",
    z.object({ projectId: z.string().min(1), push: z.boolean(), confirm: z.boolean() }).strict(),
  ),
  cmd("boardsync.status", z.object({ projectId: z.string().min(1) }).strict()),
  cmd("boardsync.syncNow", z.object({ projectId: z.string().min(1) }).strict()),
  cmd("boardsync.log", z.object({ cardId: z.string().min(1) }).strict()),
  /** Phase 39: the models a runtime offers (OpenCode's `models`); refused when it is not there. */
  cmd("runtime.models", z.object({ runtime: z.literal("opencode") }).strict()),
  /** Clones a repository into a folder inside the allowed roots; a refusal carries its reason. */
  cmd(
    "projects.clone",
    z
      .object({
        url: z.string().min(1).max(2048),
        root: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
      })
      .strict(),
  ),
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
      /** Phase 40: the message the person confirmed, instead of the default one. */
      message: z
        .string()
        .min(1)
        .max(5000)
        .regex(/^[^\0]*$/)
        .optional(),
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
  ...secretsCommands,
  ...usageCommands,
  ...collaborationCommands,
  ...terminalCommands,
  ...personasCommands,
  ...snippetsCommands,
  ...agentSetupCommands,
  ...permissionsCommands,
  ...hostCommands,
  ...teleportCommands,
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
  /**
   * What this connection can ask for before `host.info` answers (#1191): `watch.snapshot`, the
   * current summaries in the ack of `sessions.watch`. Absent from an older host.
   */
  features: z.array(z.string()).optional(),
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

/** The host lists the sessions a restart interrupted (`session.interrupted`); the app gates on it. */
export const FEATURE_RESUME_OFFER = "resume-offer";

/** A session a daemon restart interrupted (issue #150): what the resume offer lists. */
export const InterruptedSession = z.object({
  sessionId: z.string(),
  name: z.string().nullable(),
  cwd: z.string(),
  /** The persona it was opened with, by name. */
  persona: z.string().nullable(),
  /** When the restart marked it, and how long it had run before. */
  interruptedAt: z.string(),
  ranMs: z.number().int().nonnegative(),
  /** The last thing the person asked it, cut short; null when it was never asked. */
  lastRequest: z.string().nullable(),
});
export type InterruptedSession = z.infer<typeof InterruptedSession>;
export const SessionInterruptedResult = z.object({ sessions: z.array(InterruptedSession) });
export type SessionInterruptedResult = z.infer<typeof SessionInterruptedResult>;

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

/** Issue #196: whether a folder is trusted, and through which record (a parent folder may be the one). */
export const ProjectTrustState = z.object({
  path: z.string(),
  trusted: z.boolean(),
  via: z.string().nullable(),
  /** Issue #463: live sessions in the folder that still run with the setup they loaded before the trust was revoked; absent when none. */
  staleSessions: z.number().int().positive().optional(),
});
export type ProjectTrustState = z.infer<typeof ProjectTrustState>;
export const ProjectTrustStates = z.object({ items: z.array(ProjectTrustState) });
export type ProjectTrustStates = z.infer<typeof ProjectTrustStates>;

/** What a project's own files would load into a session, read without running anything. */
export const ProjectLoad = z.object({
  path: z.string(),
  hooks: z.array(z.object({ event: z.string(), file: z.string(), commands: z.array(z.string()) })),
  mcpServers: z.array(z.object({ name: z.string(), file: z.string(), command: z.string() })),
  envKeys: z.array(z.string()),
  allowRules: z.array(z.string()),
  /** What the settings deny (#75); absent from a host older than it. */
  denyRules: z.array(z.string()).optional(),
  defaultMode: z.string().nullable(),
  agents: z.array(z.string()),
  skills: z.array(z.string()),
  commands: z.array(z.string()),
  claudeMd: z.boolean(),
  /** Settings that name a program to run (apiKeyHelper, statusLine, ...): the whole command. */
  executables: z.array(z.object({ key: z.string(), file: z.string(), command: z.string() })),
  /** Environment variables that send traffic or code elsewhere (a base URL, a proxy, NODE_OPTIONS): the value too. */
  redirects: z.array(z.object({ key: z.string(), file: z.string(), value: z.string() })),
  /** Plugins and marketplaces the settings turn on or add. */
  plugins: z.array(z.string()),
  /** Settings keys present that this listing does not explain, so a key it does not know is still named. */
  otherKeys: z.array(z.string()),
  /** Agent, skill and command files whose header carries hooks, servers or tool grants. */
  extras: z.array(z.object({ file: z.string(), keys: z.array(z.string()) })),
  unreadable: z.array(z.string()),
  /** How many entries of each list were left out because the list is capped: the screen must say so. */
  omitted: z.object({
    hooks: z.number().int().min(0),
    mcpServers: z.number().int().min(0),
    allowRules: z.number().int().min(0),
    denyRules: z.number().int().min(0).optional(),
    envKeys: z.number().int().min(0),
  }),
});
export type ProjectLoad = z.infer<typeof ProjectLoad>;

/** #75: what a hook command is for, when its command says so. */
export type HookKind = "format" | "gitAdd" | "secrets";

/**
 * The formatter commands, one pattern each: the tools that format, a runner's format script, and
 * black. A script named format:check (or -verify, -lint, -ci, -diff) checks; format:write or
 * format-all formats. `black` counts as the command run, or behind a runner (`poetry run`,
 * `python -m`, `uvx`), never as a word in another command (`echo black`). `[ \t]*`, not `\s*`: a
 * run of newlines would let each one start a scan of the rest (quadratic on a crafted command).
 */
const FORMATTERS = [
  String.raw`\b(biome|prettier|eslint --fix|ruff format|gofmt|go fmt|deno fmt|rustfmt|cargo fmt|dotnet format)`,
  String.raw`\b(npm|pnpm|yarn|bun) run (format|fmt)(?!\w)(?![:-](check|verify|lint|ci|diff)\b)`,
  String.raw`(^|[;&|(\n]|(\brun|\bexec|\bnpx|\buvx?|\s-m)\s)[ \t]*black\b`,
];

/**
 * Commands that show what a hook is for, on the event it acts on: a formatter after a tool runs, a
 * check on `git add` or on secret files before one. The checklist and the preview read hooks with
 * the same list, so a hook the preview proposed is one the checklist then finds.
 */
export const HOOK_KINDS: ReadonlyArray<readonly [HookKind, string, RegExp]> = [
  ["format", "PostToolUse", new RegExp(FORMATTERS.join("|"))],
  ["gitAdd", "PreToolUse", /\bgit add\b/],
  ["secrets", "PreToolUse", /(\.env\b|credentials|secrets?\b|\.pem\b|id_rsa)/],
];

/** Whether this host lets a session start in `bypassPermissions` (off until a person turns it on). */
export const SleepResult = z.object({
  /** What came of it: `slept`, `already` (nothing was alive), or why it was not allowed. */
  result: z.enum(["slept", "already", "not_idle", "queued", "subscribed", "kept_awake"]),
});
export type SleepResult = z.infer<typeof SleepResult>;

export const BoardSettings = z.object({ maxParallelRuns: z.number().int().min(1) });
export type BoardSettings = z.infer<typeof BoardSettings>;

/** Issue #1568: what looking at the project's remote did (`project.detectProvider`). */
export const ProjectDetectResult = z.object({
  /** The project as it is now: with the provider set when the outcome is `set`. */
  project: Project,
  /**
   * `set`: GitHub or Azure DevOps was found and saved. `kept`: the project had a provider already.
   * `no_remote`: the repository has no `origin`. `unsupported`: it has one, on another service (or
   * a GitHub Enterprise server, which is set by hand). `unreadable`: git could not read the repository.
   */
  outcome: z.enum(["set", "kept", "no_remote", "unsupported", "unreadable"]),
  /** The remote's host name (`gitlab.com`), for `unsupported`; never the address with its path or credentials. */
  host: z.string().nullable(),
});
export type ProjectDetectResult = z.infer<typeof ProjectDetectResult>;

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

/** #1200: the host can install itself as a service from the app (`service.install`). */
export const FEATURE_SERVICE_INSTALL = "serviceInstall";

export const HooksStatusResult = z.object({
  status: z.enum(["installed", "absent", "outdated"]),
  /** The settings.json the hooks go to. */
  settingsPath: z.string(),
  /** Receptor of this daemon, `null` until hooks are installed. */
  receptorUrl: z.string().nullable(),
});
export type HooksStatusResult = z.infer<typeof HooksStatusResult>;

/** Issue #152: why a worktree is kept and not offered for removal. */
export const WorktreeBlocker = z.enum([
  "live_session",
  "running",
  "dirty",
  "unpushed",
  "unknown_base",
  /** git could not say (a command failed or answered nonsense): nothing is removed. */
  "unknown_state",
  /** The worktree is on a branch that is not one of Flightdeck's `fd/*`. */
  "other_branch",
  /** It holds files git ignores that are not rebuildable (not `node_modules`, build output…). */
  "ignored_files",
  /** A tracked file is hidden from `git status` (`assume-unchanged`, `skip-worktree`): its edits would go. */
  "hidden_changes",
]);
export type WorktreeBlocker = z.infer<typeof WorktreeBlocker>;
export const WorktreeItem = z.object({
  projectId: z.string(),
  projectName: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  cardId: z.string().nullable(),
  cardTitle: z.string().nullable(),
  column: BoardColumn.nullable(),
  prState: PrState.nullable(),
  dirty: z.boolean(),
  /** Commits that exist nowhere else: not on a remote and not on the base branch. */
  unpushed: z.number().int().nonnegative(),
  /** Bytes on disk; null when the scan was not finished in time (never shown as 0). */
  sizeBytes: z.number().nonnegative().nullable(),
  /** The newest of the last commit, the card's last change and the folder's. */
  lastActivity: z.string(),
  idleDays: z.number().nonnegative(),
  blockers: z.array(WorktreeBlocker),
  /** Safe to remove and worth it: no blocker, finished or without a card, idle over 7 days. */
  suggested: z.boolean(),
});
export type WorktreeItem = z.infer<typeof WorktreeItem>;
export const WorktreesResult = z.object({
  worktrees: z.array(WorktreeItem),
  disks: z.array(
    z.object({
      projectId: z.string(),
      totalBytes: z.number().nonnegative(),
      freeBytes: z.number().nonnegative(),
    }),
  ),
});
export type WorktreesResult = z.infer<typeof WorktreesResult>;
export const WorktreeRemoveResult = z.object({
  removed: z.array(
    z.object({
      path: z.string(),
      freedBytes: z.number().nonnegative().nullable(),
      /** The folder went but its branch was kept: it had moved, or git refused to delete it. */
      branchKept: z.boolean().optional(),
    }),
  ),
  kept: z.array(
    z.object({
      path: z.string(),
      reason: z.union([WorktreeBlocker, z.enum(["not_listed", "failed"])]),
      detail: z.string().optional(),
    }),
  ),
});
export type WorktreeRemoveResult = z.infer<typeof WorktreeRemoveResult>;
export interface CommandResults
  extends SecretsResults,
    UsageResults,
    CollaborationResults,
    TerminalResults,
    PersonasResults,
    SnippetsResults,
    AgentSetupResults,
    PermissionsResults,
    HostResults,
    TeleportResults {
  hello: HelloResult;
  "session.list": SessionListResult;
  "session.create": SessionCreateResult;
  "session.send": SessionSendResult;
  "session.interrupt": undefined;
  "session.setMode": undefined;
  "session.setModel": undefined;
  "session.setEffort": undefined;
  "session.close": undefined;
  "session.sleep": SleepResult;
  "session.resume": undefined;
  "session.interrupted": SessionInterruptedResult;
  "session.subscribe": SessionSubscribeResult;
  "session.unsubscribe": undefined;
  /** With `snapshot: "ack"`: every session's current summary; otherwise nothing. */
  "sessions.watch": { summaries: SessionEventOf<"session.summary">[] } | undefined;
  "history.list": HistoryListResult;
  "history.get": HistoryGetResult;
  "history.tool": HistoryToolResult;
  "history.search": HistorySearchResult;
  "history.resume": SessionCreateResult;
  "history.watch": undefined;
  "project.list": ProjectListResult;
  "project.add": Project;
  "project.update": Project;
  "project.detectProvider": ProjectDetectResult;
  "board.get": BoardResult;
  "board.settings": BoardSettings;
  "project.trust.state": ProjectTrustStates;
  "project.trust.inspect": ProjectLoad;
  "project.harness.stack": HarnessStack;
  "project.harness.preview": HarnessPreview;
  "project.harness.apply": HarnessApplied;
  "project.harness.commit": HarnessCommitted;
  "project.harness.draft": HarnessDraft;
  "project.harness.export": HarnessTemplateInfo;
  "project.trust.set": ProjectTrustState;
  "board.watch": undefined;
  "card.create": Card;
  "card.update": Card;
  "card.checkLoop": Card;
  "card.move": Card;
  "card.start": Card;
  "card.stop": Card;
  "card.diff": CardDiff;
  "card.review": CardReviewResult;
  "assistant.run": AssistantResult;
  "assistant.cancel": undefined;
  "assistant.context": AssistantContextBundle;
  "assistant.record": undefined;
  "card.message": SessionSendResult;
  "card.pr.create": Card;
  "card.pr.merge": Card;
  "card.manage": Card;
  "card.complete": Card;
  "card.discard": Card;
  "card.delete": Card;
  "card.dismissUnblocked": Card;
  "external.list": { sessions: ExternalSession[] };
  "external.watch": undefined;
  "external.message": undefined;
  "session.meta.set": SessionMeta & { claudeSessionId: string };
  "worktree.list": WorktreesResult;
  "worktree.remove": WorktreeRemoveResult;
  "snapshots.list": { snapshots: SnapshotInfo[] };
  "snapshots.files": SnapshotFiles;
  "rewind.preview": RewindPreview;
  "rewind.apply": RewindPreview;
  "rewind.undo": RewindPreview;
  "session.fork": { claudeSessionId: string; sessionId?: string; command?: string };
  "watch.settings": WatchSettings;
  "watch.set": WatchInfo;
  "watch.get": WatchInfo;
  "watch.extend": WatchInfo;
  "watch.resolveHeld": WatchInfo;
  "watch.trace": CardTraceInfo;
  "watch.describe": { text: string; redacted: number };
  "watch.byUrl": UrlTraceInfo;
  "watch.watch": undefined;
  "names.list": { names: SessionNameInfo[] };
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
  "hooks.status": HooksStatusResult;
  "hooks.install": HooksStatusResult;
  "hooks.uninstall": HooksStatusResult;
  "card.get": Card;
  "card.spec": Card;
  "card.validationTemplate": ValidationTemplate;
  "card.templates": CardTemplates;
  "workflow.list": { workflows: WorkflowInfo[] };
  "workflow.templates": { templates: WorkflowTemplate[] };
  "workflow.template.add": WorkflowTemplateAdded;
  "alert.list": { alerts: RepoAlert[]; unavailable: AlertsUnavailable[] };
  "workflow.validate": WorkflowInfo;
  "workflow.trust": WorkflowInfo;
  "runenv.config": RunConfigInfo;
  "runenv.trust": RunConfigInfo;
  "runenv.start": RunState;
  "runenv.stop": RunState;
  "runenv.get": RunState;
  "runenv.watch": undefined;
  "run.get": WorkflowRun;
  "run.watch": undefined;
  "gate.respond": WorkflowRun;
  "run.resume": RunResumeCheck;
  "telemetry.session": TelemetrySession;
  "telemetry.summary": TelemetrySummary;
  "trace.get": SessionTrace;
  "session.summary": SessionRecap;
  "trace.export": TraceExport;
  "bg.list": BgList;
  "bg.stop": BgList;
  "bg.respawn": BgList;
  "bg.message": BgList;
  "bg.start": { id: string };
  "telemetry.status": TelemetryOptInStatus;
  "telemetry.install": TelemetryOptInStatus;
  "telemetry.uninstall": TelemetryOptInStatus;
  "changes.get": ChangesResult;
  "pr.comments": { comments: PrComment[] };
  "session.applyPersona": PersonaSwitchResult;
  "session.clearPersona": PersonaSwitchResult;
  "files.sessions": { sessions: FileSession[] };
  "projects.scan": ProjectsScanResult;
  "projects.clone": ProjectsCloneResult;
  "activity.since": ActivitySinceResult;
  "boardsync.boards": { boards: BoardSyncBoard[] };
  "boardsync.link": BoardSyncStatus;
  "boardsync.unlink": undefined;
  "boardsync.setMap": BoardSyncStatus;
  "boardsync.setPush": BoardSyncStatus;
  "boardsync.status": BoardSyncStatus;
  "boardsync.syncNow": { status: BoardSyncStatus; report: BoardSyncReport };
  "boardsync.log": { entries: BoardSyncLogEntry[] };
  "runtime.models": { models: Array<{ id: string; name: string }> };
  "github.status": GithubStatusResult;
  "github.login.start": GithubLoginResult;
  "github.login.cancel": undefined;
  "github.logout": undefined;
  "github.repos": { repos: GithubRepoItem[] };
  "github.issues": { issues: Issue[] };
  "github.start": GithubStartResult;
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
  "changes.commit": ChangesCommitted;
  "changes.pr": ChangesPrOpened;
  "changes.undoRevert": { path: string };
  /** `hash`: sha256 of the bytes, hex, for `file.write`. */
  "file.read": { path: string; text: string; hash: string; size: number };
  "file.list": FileListing;
  "file.search": FileSearchResult;
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
  /** A person's move to a column whose contract the card does not meet (issue #78). */
  "contract_unmet",
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
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Why, when the app has a text for it (a snippet refusal): with the values it fills in. */
    reason: z.string().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    /** One item per problem in a list the person typed (a vault rule): where, which kind, its values. */
    items: z
      .array(
        z.object({
          path: z.string(),
          code: z.string(),
          params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        }),
      )
      .optional(),
  }),
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
/** A card's run environment changed (after `runenv.watch`). */
export const RunEnvUpdated = z.object({ type: z.literal("runenv.updated"), state: RunState });
export type RunEnvUpdated = z.infer<typeof RunEnvUpdated>;

export const RunUpdated = z.object({ type: z.literal("run.updated"), run: WorkflowRun });
export type RunUpdated = z.infer<typeof RunUpdated>;

/** Sent after `changes.watch`: the target's diff after a change on disk. */
export const ChangesUpdated = z.object({
  type: z.literal("changes.updated"),
  ...ChangesResult.shape,
});
export type ChangesUpdated = z.infer<typeof ChangesUpdated>;

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
  RunEnvUpdated,
  QuotaUpdated,
  AccountUpdated,
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
  WatchUpdatedFrame,
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

export * from "./activity.ts";
export * from "./agent-setup.ts";
export * from "./assistant.ts";
export * from "./assistant-prompts.ts";
export * from "./board-contracts.ts";
export * from "./collaboration.ts";
export * from "./compare.ts";
export * from "./fix-safe.ts";
export * from "./git-ref.ts";
export * from "./host.ts";
export * from "./localized-text.ts";
export * from "./pairing.ts";
export * from "./permissions.ts";
export * from "./personas.ts";
export * from "./question.ts";
export * from "./refusals.ts";
export * from "./review-message.ts";
export * from "./run.ts";
export * from "./secrets.ts";
export * from "./sequence.ts";
export * from "./snippets.ts";
export * from "./teleport.ts";
export * from "./terminal.ts";
export * from "./usage.ts";

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
// Issue #1600: the session schemas moved to sessions.ts; ListExtras stays inside the package.
export {
  NAME_GENERAL,
  NAME_NO_PROJECT,
  SessionLine,
  SessionMeta,
  SessionNameInfo,
  SessionRuntime,
  SessionStatus,
  SessionSummary,
  SessionTeam,
} from "./sessions.ts";
