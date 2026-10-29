import type { ExternalStatus, SessionLine, SessionMeta, SessionStatus } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";
import { basename } from "./paths.ts";

export type HubOrigin = "flightdeck" | "terminal" | "history";
export type HubState = "running" | "needs_you" | "idle" | "ended";

/** One line of the Sessões screen, whatever the session's origin. */
export interface HubRow {
  key: string;
  hostId: string;
  hostName: string;
  origin: HubOrigin;
  claudeSessionId: string | null;
  /** Managed sessions only: the daemon's session id. */
  sessionId: string | null;
  title: string;
  cwd: string;
  projectKey: string;
  state: HubState;
  controllable: boolean;
  lastActivity: string;
  pinned: boolean;
  archived: boolean;
  /** What the daemon says about it (phase 8); absent on older daemons. */
  summary: SessionLine | null;
}

export interface HubFilter {
  text: string;
  /** Host name, or "" for all. */
  host: string;
  origin: "" | HubOrigin;
  state: "" | HubState;
  pinnedOnly: boolean;
  showArchived: boolean;
}

/** Where the hub's filters are kept (not the typed text: a stale one would hide rows). */
export const HUB_FILTER_KEY = "flightdeck.hubFilter";

export const DEFAULT_HUB_FILTER: HubFilter = {
  text: "",
  host: "",
  origin: "",
  state: "",
  pinnedOnly: false,
  showArchived: false,
};

const ORIGINS: readonly string[] = ["", "flightdeck", "terminal", "history"];
const STATES: readonly string[] = ["", "running", "needs_you", "idle", "ended"];

/** The stored filters, field by field: anything unreadable falls back to its default. */
export function loadHubFilter(storage: { getItem(key: string): string | null }): HubFilter {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(storage.getItem(HUB_FILTER_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    // Not JSON: the defaults.
  }
  const text = (key: string, allowed?: readonly string[]) => {
    const value = stored[key];
    return typeof value === "string" && (!allowed || allowed.includes(value)) ? value : "";
  };
  return {
    text: "",
    host: text("host"),
    origin: text("origin", ORIGINS) as HubFilter["origin"],
    state: text("state", STATES) as HubFilter["state"],
    pinnedOnly: stored.pinnedOnly === true,
    showArchived: stored.showArchived === true,
  };
}

export function saveHubFilter(
  storage: { setItem(key: string, value: string): void },
  filter: HubFilter,
): void {
  const { text: _typed, ...kept } = filter;
  storage.setItem(HUB_FILTER_KEY, JSON.stringify(kept));
}

export interface HubGroup {
  key: string;
  /** Repository name (or folder) shown on the group. */
  name: string;
  rows: HubRow[];
}

export const ORIGIN_LABELS: Record<HubOrigin, string> = {
  flightdeck: "Flightdeck",
  terminal: "terminal",
  history: "histórico",
};

export const STATE_LABELS: Record<HubState, string> = {
  running: "rodando",
  needs_you: "precisa de você",
  idle: "ociosa",
  ended: "encerrada",
};

const MANAGED: Record<SessionStatus, HubState> = {
  starting: "running",
  running: "running",
  awaiting_permission: "needs_you",
  idle: "idle",
  ended: "ended",
  error: "ended",
};

const EXTERNAL: Record<ExternalStatus, HubState> = {
  running: "running",
  awaiting_permission: "needs_you",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
};

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
  live: AppState["hosts"][number]["sessions"][number] | undefined,
): SessionLine | null {
  if (!line || !live) return line ?? null;
  const state = LINE[live.status];
  const tool =
    state === "waiting"
      ? (live.pendingPermissions[0]?.toolName ?? null)
      : state === "running"
        ? line.tool
        : null;
  return { ...line, state, tool, since: live.updatedAt };
}

const NO_META: SessionMeta = { name: null, pinned: false, archived: false };

/**
 * Every session of every host: managed ones (live status from the summaries), external ones
 * (from hooks) and the history, each claudeSessionId once (managed, then external, then history).
 */
export function hubRows(state: AppState): HubRow[] {
  return state.hosts.flatMap((host) => {
    const data = state.hub[host.id] ?? { managed: [], history: [] };
    const meta = (id: string | null) =>
      (id ? state.meta[`${host.id}/${id}`] : undefined) ?? NO_META;
    const seen = new Set<string>();
    const base = (id: string | null, cwd: string, key: string | null | undefined) => {
      if (id) seen.add(id);
      const { name, pinned, archived } = meta(id);
      return {
        hostId: host.id,
        hostName: host.name,
        claudeSessionId: id,
        cwd,
        name,
        pinned,
        archived,
        projectKey: key ?? `host:${host.name}:${cwd}`,
      };
    };
    const managed = data.managed.map((s): HubRow => {
      const { name, ...common } = base(s.claudeSessionId, s.cwd, s.projectKey);
      const live = host.sessions.find((x) => x.id === s.id);
      return {
        ...common,
        key: `${host.id}/m/${s.id}`,
        origin: "flightdeck",
        sessionId: s.id,
        title: name ?? s.name ?? basename(s.cwd),
        state: MANAGED[live?.status ?? s.status],
        controllable: false,
        lastActivity: live?.updatedAt ?? s.updatedAt,
        summary: liveLine(s.summary, live),
      };
    });
    const externals = Object.entries(state.externals)
      .filter(([key, s]) => key.startsWith(`${host.id}/`) && !seen.has(s.claudeSessionId))
      .map(([, s]): HubRow => {
        const { name, ...common } = base(s.claudeSessionId, s.cwd ?? "", s.projectKey);
        return {
          ...common,
          key: `${host.id}/e/${s.claudeSessionId}`,
          origin: "terminal",
          sessionId: null,
          title: name ?? basename(s.cwd ?? s.claudeSessionId),
          state: EXTERNAL[s.status],
          controllable: s.controllable,
          lastActivity: s.lastEventAt,
          summary: s.summary ?? null,
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
          title: name ?? s.title ?? basename(s.cwd),
          state: "ended",
          controllable: false,
          lastActivity: s.lastTs ?? "",
          summary: s.summary ?? null,
        };
      });
    return [...managed, ...externals, ...history];
  });
}

const matches = (row: HubRow, filter: HubFilter) =>
  `${row.title}\n${row.cwd}\n${row.hostName}`
    .toLowerCase()
    .includes(filter.text.trim().toLowerCase()) &&
  (!filter.host || row.hostName === filter.host) &&
  (!filter.origin || row.origin === filter.origin) &&
  (!filter.state || row.state === filter.state) &&
  (!filter.pinnedOnly || row.pinned) &&
  (filter.showArchived || !row.archived);

/** Repository name of a group: last path segment of the remote or of the folder. */
const groupName = (key: string) => basename(key.replace(/^host:[^:]*:/, ""));

/**
 * Filtered rows by project; the ones that need you first, then pinned, then latest activity;
 * groups by latest activity.
 */
export function hubGroups(rows: HubRow[], filter: HubFilter): HubGroup[] {
  const byKey = new Map<string, HubRow[]>();
  for (const row of rows.filter((r) => matches(r, filter))) {
    byKey.set(row.projectKey, [...(byKey.get(row.projectKey) ?? []), row]);
  }
  const order = (a: HubRow, b: HubRow) =>
    Number(b.state === "needs_you") - Number(a.state === "needs_you") ||
    Number(b.pinned) - Number(a.pinned) ||
    b.lastActivity.localeCompare(a.lastActivity);
  return [...byKey.entries()]
    .map(([key, list]) => ({ key, name: groupName(key), rows: list.sort(order) }))
    .sort((a, b) => (b.rows[0]?.lastActivity ?? "").localeCompare(a.rows[0]?.lastActivity ?? ""));
}

/** The session's line in the lists: "Pedido: …" and what it is doing, at `nowMs`. */
export function sessionLineText(line: SessionLine | null | undefined, nowMs: number): string {
  if (!line) return "";
  return [line.request ? `Pedido: ${line.request}` : "", activity(line, nowMs)]
    .filter(Boolean)
    .join(" · ");
}

function activity(line: SessionLine, nowMs: number): string {
  switch (line.state) {
    case "running":
      return line.tool ? `rodando ${line.tool}` : "rodando";
    case "waiting":
      return line.tool ? `esperando aprovação de ${line.tool}` : "esperando aprovação";
    case "idle":
      return `ociosa ${idleFor(nowMs - Date.parse(line.since ?? ""))}`;
    case "ended":
      return "";
  }
}

/** "há 12 min", "há 2 h"; unknown since says just "ociosa". */
function idleFor(ms: number): string {
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "há menos de 1 min";
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h`;
}
