import type {
  BgList,
  ExternalSession,
  ExternalStatus,
  HistorySessionSummary,
  SessionLine,
  SessionMeta,
  SessionNameInfo,
  SessionStatus,
  SessionSummary,
} from "@flightdeck/protocol";
import type { T } from "../../../i18n/index.ts";
import type { HubRow, HubState } from "./hub-row.ts";
import { rowTitle } from "./hub-title.ts";
import { sessionLabel } from "./session-label.ts";

/** The quiet fields of a session's summary, when the host marked it quiet. */
function quietOf(session: {
  quietSince?: string | undefined; // NOSONAR: exactOptionalPropertyTypes needs the explicit undefined
  quietTool?: string | null | undefined; // NOSONAR: exactOptionalPropertyTypes needs the explicit undefined
}) {
  return session.quietSince
    ? { quietSince: session.quietSince, quietTool: session.quietTool ?? null }
    : {};
}

const MANAGED: Record<SessionStatus, HubState> = {
  starting: "running",
  running: "running",
  awaiting_permission: "needs_you",
  idle: "idle",
  ended: "ended",
  // A session that stopped on an error failed: it is not one closed on purpose (#1132).
  error: "failed",
};

const EXTERNAL: Record<ExternalStatus, HubState> = {
  running: "running",
  awaiting_permission: "needs_you",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
};

/** The hub state of a terminal session: what its hooks said, and a plan or a question it waits at (#1736). */
export function externalState(session: ExternalSession): HubState {
  // A session that ended is over, whatever its transcript's end says; one that asks for a permission
  // already needs the person.
  if (session.waiting && session.status !== "ended") return "needs_you";
  return EXTERNAL[session.status];
}

/** A managed session's line state, from its status. */
const LINE: Record<SessionStatus, SessionLine["state"]> = {
  starting: "running",
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  ended: "ended",
  error: "ended",
};

/**
 * The list's line of a managed session with its live state on top: the lists reload only when
 * sessions come and go, while `session.summary` follows every change. The request (and the
 * running tool) stay the list's.
 */
function liveLine(
  line: SessionLine | undefined,
  live: LiveSession | undefined,
): SessionLine | null {
  if (!line || !live) return line ?? null;
  const state = LINE[live.status];
  let tool: string | null = null;
  if (state === "waiting") tool = live.pendingPermissions[0]?.toolName ?? null;
  else if (state === "running") tool = line.tool;
  return { ...line, state, tool, since: live.updatedAt };
}

/** What a background session's state means for the hub. */
const BACKGROUND: Record<string, HubState> = {
  working: "running",
  blocked: "needs_you",
  done: "idle",
  failed: "failed",
  stopped: "ended",
};

const NO_META: SessionMeta = { name: null, pinned: false, archived: false };

/** What a host's live session summary gives a row: its state, its permissions and whether it is quiet. */
interface LiveSession {
  id: string;
  status: SessionStatus;
  updatedAt: string;
  pendingPermissions: ReadonlyArray<{ toolName: string }>;
  quietSince?: string | undefined; // NOSONAR: exactOptionalPropertyTypes needs the explicit undefined
  quietTool?: string | null | undefined; // NOSONAR: exactOptionalPropertyTypes needs the explicit undefined
}

/**
 * The fields of the app's state the rows read, declared here (the app's state fits it) so this
 * file and hub.ts do not import the store and stay out of its import cycle.
 */
export interface HubRowState {
  hosts: ReadonlyArray<{ id: string; name: string; sessions: ReadonlyArray<LiveSession> }>;
  hub: Record<string, { managed: SessionSummary[]; history: HistorySessionSummary[] }>;
  meta: Record<string, SessionMeta>;
  externals: Record<string, ExternalSession>;
  names: Record<string, SessionNameInfo[]>;
  background: Record<string, BgList>;
  personas?: Record<string, ReadonlyArray<{ id: string; name: string }>>;
}

/**
 * Every session of every host: managed ones (live status from the summaries), external ones
 * (from hooks) and the history, each claudeSessionId once (managed, then external, then history).
 */
/** `t`: the dictionaries, so a team session is named by its persona (#101); without, as before. */
export function hubRows(state: HubRowState, t?: T): HubRow[] {
  return state.hosts.flatMap((host) => {
    const data = state.hub[host.id] ?? { managed: [], history: [] };
    const meta = (id: string | null) =>
      (id ? state.meta[`${host.id}/${id}`] : undefined) ?? NO_META;
    const seen = new Set<string>();
    const names = new Map((state.names[host.id] ?? []).map((n) => [n.sessionId, n]));
    const base = (
      id: string | null,
      cwd: string,
      key: string | null | undefined,
      managedId?: string,
    ) => {
      if (id) seen.add(id);
      const meta_ = meta(id);
      const standard = names.get(managedId ?? "") ?? names.get(id ?? "");
      return {
        // The name the user gave wins; then a team's persona name, or the standard one (#101);
        // then the origin's own title.
        name: sessionLabel(
          { metaName: meta_.name, names: standard, personas: state.personas?.[host.id] },
          t,
        ),
        pinned: meta_.pinned,
        archived: meta_.archived,
        // What the list sorts by: the standard name as the person reads it (#668).
        standardName: standard
          ? sessionLabel({ names: standard, personas: state.personas?.[host.id] }, t)
          : null,
        hostId: host.id,
        hostName: host.name,
        claudeSessionId: id,
        cwd,
        projectKey: key ?? `host:${host.name}:${cwd}`,
      };
    };
    const managed = data.managed.map((s): HubRow => {
      const { name, ...common } = base(s.claudeSessionId, s.cwd, s.projectKey, s.id);
      const live = host.sessions.find((x) => x.id === s.id);
      return {
        ...common,
        key: `${host.id}/m/${s.id}`,
        origin: "flightdeck",
        sessionId: s.id,
        title: rowTitle({
          name,
          title: s.name,
          persona: s.persona ?? null,
          request: s.summary?.request ?? null,
          cwd: s.cwd,
        }),
        state: MANAGED[live?.status ?? s.status],
        asleep: MANAGED[live?.status ?? s.status] === "idle" && s.asleep === true,
        controllable: false,
        lastActivity: live?.updatedAt ?? s.updatedAt,
        // Issue #1478: the live summary is newer than the list, so it alone says whether it is quiet.
        ...quietOf(live ?? s),
        summary: liveLine(s.summary, live),
        persona: s.persona ?? null,
        ...(s.runtime === "opencode" ? { runtime: "opencode" as const } : {}),
      };
    });
    // Claude Code's background sessions: a session the host has under another origin stays there.
    const background = (state.background[host.id]?.sessions ?? [])
      .filter((b) => !b.claudeSessionId || !seen.has(b.claudeSessionId))
      .map((b): HubRow => {
        const { name, ...common } = base(b.claudeSessionId, b.cwd, null);
        return {
          ...common,
          key: `${host.id}/b/${b.id}`,
          origin: "background",
          sessionId: null,
          title: rowTitle({
            name,
            title: b.name,
            persona: null,
            request: null,
            cwd: b.cwd,
          }),
          state: BACKGROUND[b.state] ?? "idle",
          controllable: false,
          lastActivity: b.startedAt === null ? "" : new Date(b.startedAt).toISOString(),
          summary: null,
          persona: null,
        };
      });
    const terminal = Object.entries(state.externals).filter(
      ([key, s]) => key.startsWith(`${host.id}/`) && !seen.has(s.claudeSessionId),
    );
    // A terminal session sits under its transcript's project, which the history knows; the
    // terminal's own folder follows the session wherever it went (#583).
    const transcripts = new Map<string, HistorySessionSummary>();
    if (terminal.length > 0) {
      const ids = new Set(terminal.map(([, s]) => s.claudeSessionId));
      for (const h of data.history)
        if (ids.has(h.claudeSessionId)) transcripts.set(h.claudeSessionId, h);
    }
    const externals = terminal.map(([, s]): HubRow => {
      const transcript = transcripts.get(s.claudeSessionId);
      const cwd = transcript?.cwd ?? s.cwd ?? "";
      const { name, ...common } = base(
        s.claudeSessionId,
        cwd,
        transcript ? transcript.projectKey : s.projectKey,
      );
      return {
        ...common,
        key: `${host.id}/e/${s.claudeSessionId}`,
        origin: "terminal",
        sessionId: null,
        title: rowTitle({
          name,
          title: null,
          persona: s.persona ?? null,
          request: s.summary?.request ?? null,
          cwd: cwd || s.claudeSessionId,
        }),
        // At a plan or a question the session needs the person, whatever its hooks last said (#1736).
        state: externalState(s),
        ...(s.waiting && s.status !== "ended" ? { waiting: s.waiting } : {}),
        ...(s.waiting === "plan" && s.waitingPlan && s.status !== "ended"
          ? { waitingPlan: s.waitingPlan }
          : {}),
        controllable: s.controllable,
        lastActivity: s.lastEventAt,
        summary: s.summary ?? null,
        persona: s.persona ?? null,
      };
    });
    const history = data.history
      .filter((s) => !seen.has(s.claudeSessionId))
      .map((s): HubRow => {
        const { name, ...common } = base(s.claudeSessionId, s.cwd, s.projectKey);
        return {
          ...common,
          key: `${host.id}/h/${s.claudeSessionId}`,
          origin: "history",
          sessionId: null,
          title: rowTitle({
            name,
            title: s.title,
            persona: null,
            request: s.summary?.request ?? null,
            cwd: s.cwd,
          }),
          state: "ended",
          controllable: false,
          lastActivity: s.lastTs ?? "",
          summary: s.summary ?? null,
          persona: null,
        };
      });
    return [...managed, ...background, ...externals, ...history];
  });
}
