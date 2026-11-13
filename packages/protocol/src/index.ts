import { z } from "zod";
import { type ActivityResults, activityCommands } from "./activity.ts";
import { type AgentSetupResults, agentSetupCommands } from "./agent-setup.ts";
import { type AssistantResults, assistantCommands } from "./assistant.ts";
import { type AutomationsResults, automationsCommands } from "./automations.ts";
import { type BoardResults, boardCommands, CardUpdated } from "./board.ts";
import {
  type CollaborationResults,
  collaborationCommands,
  IdleFiredFrame,
  MessagesRelayFrame,
  MessagesUpdatedFrame,
  MessagingAlertFrame,
  TeamsUpdatedFrame,
} from "./collaboration.ts";
import { cmd } from "./command.ts";
import { parseFrame } from "./frame.ts";
import { HistoryChanged, type HistoryResults, historyCommands } from "./history.ts";
import { type HostResults, hostCommands } from "./host.ts";
import {
  AutoApproval,
  PendingPermission,
  PermissionMode,
  PermissionResolution,
  type PermissionsResults,
  PermissionUpdate,
  PlainInfo,
  permissionsCommands,
  RiskLevel,
  ToolInput,
} from "./permissions.ts";
import { type PersonasResults, personasCommands, SessionPersona } from "./personas.ts";
import { type ProjectsResults, projectsCommands } from "./projects.ts";
import { ChangesUpdated, type ReviewResults, reviewCommands } from "./review.ts";
import { RunEnvUpdated, type RunResults, runCommands } from "./run.ts";
import {
  AskpassRequest,
  type SecretsResults,
  secretsCommands,
  VaultAlertFrame,
  VaultRequestFrame,
  VaultUsed,
} from "./secrets.ts";
import {
  ExternalUpdated,
  SessionRuntime,
  SessionStatus,
  type SessionsResults,
  SlashCommandInfo,
  sessionsCommands,
} from "./sessions.ts";
import { type SnippetsResults, snippetsCommands } from "./snippets.ts";
import { type TelemetryResults, telemetryCommands } from "./telemetry.ts";
import { type TeleportResults, teleportCommands } from "./teleport.ts";
import {
  TerminalData,
  TerminalExited,
  type TerminalResults,
  TerminalResync,
  terminalCommands,
} from "./terminal.ts";
import { type TraceResults, traceCommands } from "./trace.ts";
import { type TrackersResults, trackersCommands } from "./trackers.ts";
import {
  AccountUpdated,
  BudgetUpdated,
  QuotaUpdated,
  Usage,
  type UsageResults,
  usageCommands,
} from "./usage.ts";
import { type WatchResults, WatchUpdatedFrame, watchCommands } from "./watch.ts";
import { RunUpdated, type WorkflowsResults, workflowsCommands } from "./workflows.ts";

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

/** The host refuses a high-risk `permission.respond` allow that does not carry `held: true`. */
export const FEATURE_HOLD_PROOF = "hold-proof";

// ---------------------------------------------------------------------------
// Phase 21: messages between sessions, and teams
// ---------------------------------------------------------------------------

export const Command = z.discriminatedUnion("type", [
  cmd("hello", HelloPayload),
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
  ...reviewCommands,
  ...automationsCommands,
  ...workflowsCommands,
  ...runCommands,
  ...traceCommands,
  ...watchCommands,
  ...boardCommands,
  ...projectsCommands,
  ...trackersCommands,
  ...historyCommands,
  ...telemetryCommands,
  ...activityCommands,
  ...assistantCommands,
  ...sessionsCommands,
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

/** The host lists the sessions a restart interrupted (`session.interrupted`); the app gates on it. */
export const FEATURE_RESUME_OFFER = "resume-offer";

/** #1200: the host can install itself as a service from the app (`service.install`). */
export const FEATURE_SERVICE_INSTALL = "serviceInstall";

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
    TeleportResults,
    ReviewResults,
    AutomationsResults,
    WorkflowsResults,
    RunResults,
    TraceResults,
    WatchResults,
    BoardResults,
    ProjectsResults,
    TrackersResults,
    HistoryResults,
    TelemetryResults,
    ActivityResults,
    AssistantResults,
    SessionsResults {
  // The summaries are session events, whose union stays here with the envelope (#1600).
  "sessions.watch": { summaries: SessionEventOf<"session.summary">[] } | undefined;
  hello: HelloResult;
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
  return parseFrame(ServerMessage, raw);
}

export * from "./activity.ts";
export * from "./agent-setup.ts";
export * from "./assistant.ts";
export * from "./assistant-prompts.ts";
export * from "./automations.ts";
export * from "./board.ts";
export * from "./board-contracts.ts";
export * from "./collaboration.ts";
export * from "./compare.ts";
export * from "./fix-safe.ts";
export * from "./git-ref.ts";
export * from "./history.ts";
export * from "./host.ts";
export * from "./localized-text.ts";
export * from "./pairing.ts";
export * from "./permissions.ts";
export * from "./personas.ts";
export * from "./projects.ts";
export * from "./question.ts";
export * from "./refusals.ts";
export * from "./review.ts";
export * from "./review-message.ts";
export * from "./run.ts";
export * from "./secrets.ts";
export * from "./sequence.ts";
export * from "./snippets.ts";
export * from "./telemetry.ts";
export * from "./teleport.ts";
export * from "./terminal.ts";
export * from "./trace.ts";
export * from "./trackers.ts";
export * from "./usage.ts";
export * from "./watch.ts";
export * from "./workflows.ts";

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
  BgList,
  BgSession,
  EffortLevel,
  ExternalSession,
  ExternalStatus,
  ExternalUpdated,
  HOOK_KINDS,
  type HookKind,
  HooksStatusResult,
  InterruptedSession,
  NAME_GENERAL,
  NAME_NO_PROJECT,
  RewindPreview,
  SESSION_IMAGE_MAX_BYTES,
  SESSION_IMAGE_MAX_COUNT,
  SESSION_IMAGE_TYPES,
  SessionCreatePayload,
  SessionCreateResult,
  SessionFile,
  SessionIdPayload,
  SessionImage,
  SessionInterruptedResult,
  SessionLine,
  SessionListPayload,
  SessionListResult,
  SessionMeta,
  SessionNameInfo,
  SessionRecap,
  SessionRuntime,
  SessionSendPayload,
  SessionSendResult,
  SessionStatus,
  SessionSubscribePayload,
  SessionSubscribeResult,
  SessionSummary,
  type SessionsResults,
  SessionTeam,
  SlashCommandInfo,
  SleepResult,
  SnapshotFiles,
  SnapshotInfo,
  sessionsCommands,
} from "./sessions.ts";
