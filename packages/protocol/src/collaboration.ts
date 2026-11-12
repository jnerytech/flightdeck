// The Collaboration context: messages between sessions, their policy, and teams (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { PermissionMode } from "./permissions.ts";
import { EffortLevel, SessionLine } from "./sessions.ts";

/** Who sends: a managed session by its id, or a terminal session by its launch id. */
export const SessionIdentity = z
  .object({ session: z.string().min(1).optional(), launch: z.string().min(1).optional() })
  .refine((who) => (who.session === undefined) !== (who.launch === undefined), {
    message: "give the session (session) or the launch (launch), one of the two",
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
  /** The model it was asked to run in; null is the persona's own, else the default. */
  model: z.string().nullable(),
  /** Issue #93: the permission mode it was asked to open in; null is the host's default. Absent from an older host. */
  permission: PermissionMode.nullable().optional(),
  cardId: z.string().nullable(),
  /** Null while a worker's card waits in the quota queue and has no session yet. */
  sessionId: z.string().nullable(),
  address: z.string().nullable(),
  sessionState: MessagingState.nullable(),
  /** Issue #101: a worker's number in its team (null for the coordinator). Absent from an older host. */
  number: z.number().int().nullable().optional(),
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
  /**
   * #1220: the coordinator's last report (`team_report`), the team's outcome. Text a session wrote:
   * shown as plain text, never as markup. Absent from an older host.
   */
  outcome: z.object({ text: z.string(), at: z.string(), done: z.boolean() }).nullable().optional(),
});
export type TeamStatus = z.infer<typeof TeamStatus>;

/** #1220: the longest report a coordinator may send. */
export const TEAM_REPORT_MAX = 4000;

export const TeamsUpdatedFrame = z.object({
  type: z.literal("teams.updated"),
  team: TeamInfo,
  /** Why it changed, when that is news for you (quota pause, quota resume). */
  reason: z.string().nullable(),
  /** #1220: the coordinator reported the goal done; the app tells the person in its language. */
  event: z.enum(["report_done"]).optional(),
});
export type TeamsUpdatedFrame = z.infer<typeof TeamsUpdatedFrame>;

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

/** The collaboration commands; index.ts spreads them into `Command`. */
export const collaborationCommands = [
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
      /** The model of the coordinator and of each worker; none or null is the persona's own. */
      coordinatorModel: z.string().min(1).optional(),
      workerModels: z.array(z.string().min(1).nullable()).max(8).optional(),
      /** Issue #93: the permission mode of the coordinator and of each worker; none or null is the default. */
      coordinatorPermission: PermissionMode.optional(),
      workerPermissions: z.array(PermissionMode.nullable()).max(8).optional(),
      /** Issue #2310: the effort of the coordinator and of each worker; none or null is the persona's own. */
      coordinatorEffort: EffortLevel.optional(),
      workerEfforts: z.array(EffortLevel.nullable()).max(8).optional(),
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
      /** One more worker with the persona and model asked for (none or null is the default). */
      addMember: z
        .object({
          persona: z.string().min(1).nullable().optional(),
          model: z.string().min(1).nullable().optional(),
          /** Issue #93: the permission mode the new worker opens in. */
          permission: PermissionMode.nullable().optional(),
          /** Issue #2310: the effort the new worker starts with; none or null is the persona's own. */
          effort: EffortLevel.nullable().optional(),
        })
        .optional(),
      removeMember: z.string().min(1).optional(),
    }),
  ),
  cmd("teams.pause", z.object({ team: z.string().min(1) })),
  cmd("teams.resume", z.object({ team: z.string().min(1) })),
  cmd("teams.close", z.object({ team: z.string().min(1), confirm: z.boolean().optional() })),
  /** Issue #934: deletes a closed team whose members are not at work; its sessions stay. */
  cmd("teams.delete", z.object({ team: z.string().min(1) })),
  /** A message from Flightdeck to every member ("mandar a todos"). */
  cmd("teams.message", z.object({ team: z.string().min(1), text: z.string().min(1) })),
  /** With `as`, only a member of the team may ask (the MCP tool does). */
  cmd("teams.status", z.object({ team: z.string().min(1), as: SessionIdentity.optional() })),
  cmd("teams.watch", z.object({}).strict()),
  /**
   * #1220: the coordinator's report, the team's outcome; `done` says the goal is met. Only the
   * team's coordinator (`as`, resolved by the host) may send it.
   */
  cmd(
    "teams.report",
    z
      .object({
        team: z.string().min(1),
        text: z.string().min(1).max(TEAM_REPORT_MAX),
        done: z.boolean(),
        as: SessionIdentity,
      })
      .strict(),
  ),
] as const;

/** The `data` of each collaboration command's ack; `CommandResults` extends it. */
export interface CollaborationResults {
  "teams.list": { teams: TeamInfo[] };
  "teams.create": TeamInfo;
  "teams.update": TeamInfo;
  "teams.pause": TeamInfo;
  "teams.resume": TeamInfo;
  "teams.close": TeamInfo;
  "teams.delete": TeamInfo;
  "teams.message": { delivered: number; refused: number };
  "teams.status": TeamStatus;
  "teams.report": TeamStatus;
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
}
