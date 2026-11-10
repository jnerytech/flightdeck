// The Session context: a session as every list shows it, and its commands (start, send, modes, sleep, subscribe, fork), background and terminal sessions, hooks, snapshots and rewind (issue #1600: moved from index.ts).

import { z } from "zod";
import { cmd } from "./command.ts";
import { PermissionMode, SettableMode } from "./permissions.ts";
import { PersonaRef, type PersonaSwitchResult, SessionPersona } from "./personas.ts";

export const SessionStatus = z.enum([
  "starting",
  "running",
  "awaiting_permission",
  "idle",
  "ended",
  "error",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** The team a session works in, its role there and, for a worker, its number (issue #101). */
export const SessionTeam = z.object({
  name: z.string(),
  role: z.enum(["coordinator", "worker"]),
  number: z.number().int().nullable(),
});
export type SessionTeam = z.infer<typeof SessionTeam>;

/** The persona of a standard name for a session that has none (phase 21); the app translates it (#668). */
export const NAME_GENERAL = "geral";
/** The project of a standard name for a session with no folder to name it; the app translates it (#668). */
export const NAME_NO_PROJECT = "sem-projeto";

/** The standard name of a session of the host (phase 21): `project · persona · number`. */
export const SessionNameInfo = z.object({
  /** The managed id, or the Claude session id of a terminal. */
  sessionId: z.string(),
  display: z.string(),
  /** The alias that came with the session; `aliases` has it first. */
  alias: z.string(),
  aliases: z.array(z.string()),
  project: z.string(),
  persona: z.string(),
  number: z.number().int(),
  cardNumber: z.number().int().nullable(),
  /** Issue #101: `display` is still the standard name (no rename, no Claude Code title). Absent from an older host. */
  standard: z.boolean().optional(),
  /** Issue #101: the team the session works in; the app names it by its persona. Absent from an older host. */
  team: SessionTeam.nullable().optional(),
});
export type SessionNameInfo = z.infer<typeof SessionNameInfo>;

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
export const ListExtras = {
  projectKey: z.string().nullable().optional(),
  meta: SessionMeta.optional(),
  summary: SessionLine.optional(),
  /** Issue #157: idle with no process: the daemon put it to sleep (or restarted); a message wakes it. */
  asleep: z.boolean().optional(),
};

/** Phase 39: the agent a session runs on. */
export const SessionRuntime = z.enum(["claude", "opencode"]);
export type SessionRuntime = z.infer<typeof SessionRuntime>;

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
  /** Phase 39: `claude` when absent. */
  runtime: SessionRuntime.optional(),
  /** Issue #1478 (host `stall`): a running session that went quiet, since when; absent otherwise. */
  quietSince: z.string().optional(),
  /** Issue #1478: the last tool it called; `null` when it called none. */
  quietTool: z.string().nullable().optional(),
  ...ListExtras,
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** How hard the model works (the SDK's effort levels). */
export const EffortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const SessionSendResult = z.object({ queued: z.boolean() });
export type SessionSendResult = z.infer<typeof SessionSendResult>;

export const SessionCreateResult = z.object({ sessionId: z.string() });
export type SessionCreateResult = z.infer<typeof SessionCreateResult>;

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

export const HooksStatusResult = z.object({
  status: z.enum(["installed", "absent", "outdated"]),
  /** The settings.json the hooks go to. */
  settingsPath: z.string(),
  /** Receptor of this daemon, `null` until hooks are installed. */
  receptorUrl: z.string().nullable(),
});
export type HooksStatusResult = z.infer<typeof HooksStatusResult>;

/** Sent after `external.watch` with the whole external session after each change. */
export const ExternalUpdated = z.object({
  type: z.literal("external.updated"),
  session: ExternalSession,
});
export type ExternalUpdated = z.infer<typeof ExternalUpdated>;

/** The sessions commands; index.ts spreads them into `Command`. */
export const sessionsCommands = [
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
] as const;

/** The `data` of each sessions command's ack; `CommandResults` extends it. */
export interface SessionsResults {
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
