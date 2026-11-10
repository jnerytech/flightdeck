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
  SettableMode,
  ToolInput,
} from "./permissions.ts";
import {
  PersonaRef,
  type PersonaSwitchResult,
  type PersonasResults,
  personasCommands,
  SessionPersona,
} from "./personas.ts";
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
  EffortLevel,
  type SessionCreateResult,
  SessionLine,
  SessionMeta,
  type SessionNameInfo,
  SessionRuntime,
  type SessionSendResult,
  SessionStatus,
  SessionSummary,
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

/** A file a session wrote (Write, Edit, MultiEdit, NotebookEdit; Bash does not count). */
export const SessionFile = z.object({
  path: z.string(),
  edits: z.number().int(),
  firstAt: z.string(),
  lastAt: z.string(),
});
export type SessionFile = z.infer<typeof SessionFile>;

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
  cmd("hooks.status", z.object({}).strict()),
  /** Writes to the host user's ~/.claude/settings.json: only with `confirm: true`. */
  cmd("hooks.install", z.object({ confirm: z.boolean().optional() })),
  cmd("hooks.uninstall", z.object({ confirm: z.boolean().optional() })),
  cmd("external.message", z.object({ claudeSessionId: z.string(), text: z.string().min(1) })),
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
  cmd("session.files", z.object({ claudeSessionId: z.string() })),
  /** Phase 39: the models a runtime offers (OpenCode's `models`); refused when it is not there. */
  cmd("runtime.models", z.object({ runtime: z.literal("opencode") }).strict()),
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

export const SessionSubscribeResult = z.object({
  session: SessionSummary,
  replayed: z.number().int().nonnegative(),
});
export type SessionSubscribeResult = z.infer<typeof SessionSubscribeResult>;

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
    AssistantResults {
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
  "external.list": { sessions: ExternalSession[] };
  "external.watch": undefined;
  "external.message": undefined;
  "session.meta.set": SessionMeta & { claudeSessionId: string };
  "snapshots.list": { snapshots: SnapshotInfo[] };
  "snapshots.files": SnapshotFiles;
  "rewind.preview": RewindPreview;
  "rewind.apply": RewindPreview;
  "rewind.undo": RewindPreview;
  "session.fork": { claudeSessionId: string; sessionId?: string; command?: string };
  "names.list": { names: SessionNameInfo[] };
  "hooks.status": HooksStatusResult;
  "hooks.install": HooksStatusResult;
  "hooks.uninstall": HooksStatusResult;
  "session.summary": SessionRecap;
  "bg.list": BgList;
  "bg.stop": BgList;
  "bg.respawn": BgList;
  "bg.message": BgList;
  "bg.start": { id: string };
  "session.applyPersona": PersonaSwitchResult;
  "session.clearPersona": PersonaSwitchResult;
  "runtime.models": { models: Array<{ id: string; name: string }> };
  "session.files": { files: SessionFile[] };
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
  EffortLevel,
  NAME_GENERAL,
  NAME_NO_PROJECT,
  SessionCreateResult,
  SessionLine,
  SessionMeta,
  SessionNameInfo,
  SessionRuntime,
  SessionSendResult,
  SessionStatus,
  SessionSummary,
  SessionTeam,
} from "./sessions.ts";
