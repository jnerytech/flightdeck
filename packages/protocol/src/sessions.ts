// A session as every list shows it: status, name, meta, line and summary (issue #1600: moved from index.ts).
import { z } from "zod";
import { PermissionMode } from "./permissions.ts";
import { SessionPersona } from "./personas.ts";

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
