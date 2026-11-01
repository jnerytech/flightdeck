import type {
  ExternalStatus,
  SessionLine,
  SessionMeta,
  SessionPersona,
  SessionStatus,
} from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";
import { basename } from "./paths.ts";

const PT = translator("pt-BR");

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
  /** The persona it runs in (phase 20). */
  persona: SessionPersona | null;
  /** Phase 21: `project · persona · number`, on a host with names; null elsewhere. */
  standardName?: string | null;
}

export interface HubFilter {
  text: string;
  /** Host name, or "" for all. */
  host: string;
  origin: "" | HubOrigin;
  state: "" | HubState;
  /** A persona id, or "" for all (phase 20). */
  persona: string;
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
  persona: "",
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
    persona: text("persona"),
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
  let tool: string | null = null;
  if (state === "waiting") tool = live.pendingPermissions[0]?.toolName ?? null;
  else if (state === "running") tool = line.tool;
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
        // The name the user gave wins; then the standard one; then the origin's own title.
        name: meta_.name ?? standard?.display ?? null,
        pinned: meta_.pinned,
        archived: meta_.archived,
        standardName: standard?.display ?? null,
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
        title: name ?? s.name ?? basename(s.cwd),
        state: MANAGED[live?.status ?? s.status],
        controllable: false,
        lastActivity: live?.updatedAt ?? s.updatedAt,
        summary: liveLine(s.summary, live),
        persona: s.persona ?? null,
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
          title: name ?? s.title ?? basename(s.cwd),
          state: "ended",
          controllable: false,
          lastActivity: s.lastTs ?? "",
          summary: s.summary ?? null,
          persona: null,
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
  (!filter.persona || row.persona?.id === filter.persona) &&
  (!filter.pinnedOnly || row.pinned) &&
  (filter.showArchived || !row.archived);

/** Repository name of a group: last path segment of the remote or of the folder. */
const groupName = (key: string) => basename(key.replace(/^host:[^:]*:/, ""));

/**
 * Filtered rows by project; the ones that need you first, then pinned, then the standard names
 * in order (phase 21: only hosts with names give them), then latest activity; groups by latest
 * activity.
 */
export function hubGroups(rows: HubRow[], filter: HubFilter): HubGroup[] {
  const byKey = new Map<string, HubRow[]>();
  for (const row of rows.filter((r) => matches(r, filter))) {
    const list = byKey.get(row.projectKey);
    if (list) list.push(row);
    else byKey.set(row.projectKey, [row]);
  }
  const order = (a: HubRow, b: HubRow) =>
    Number(b.state === "needs_you") - Number(a.state === "needs_you") ||
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.standardName != null) - Number(a.standardName != null) ||
    (a.standardName ?? "").localeCompare(b.standardName ?? "", undefined, { numeric: true }) ||
    b.lastActivity.localeCompare(a.lastActivity);
  return [...byKey.entries()]
    .map(([key, list]) => ({ key, name: groupName(key), rows: [...list].sort(order) }))
    .sort((a, b) => (b.rows[0]?.lastActivity ?? "").localeCompare(a.rows[0]?.lastActivity ?? ""));
}

/** The session's line in the lists: "Pedido: …" and what it is doing, at `nowMs`. */
export function sessionLineText(
  line: SessionLine | null | undefined,
  nowMs: number,
  t: T = PT,
): string {
  if (!line) return "";
  return [
    line.request ? t("line.request", { request: line.request }) : "",
    activity(line, nowMs, t),
  ]
    .filter(Boolean)
    .join(" · ");
}

function activity(line: SessionLine, nowMs: number, t: T): string {
  switch (line.state) {
    case "running":
      return line.tool ? t("line.runningTool", { tool: line.tool }) : t("line.running");
    case "waiting":
      return line.tool ? t("line.waitingTool", { tool: line.tool }) : t("line.waiting");
    case "idle":
      return t("line.idle", { since: idleFor(nowMs - Date.parse(line.since ?? ""), t) }).trim();
    case "ended":
      return "";
  }
}

/** "há 12 min", "há 2 h"; unknown since says just "ociosa". */
function idleFor(ms: number, t: T): string {
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("line.lessThanMinute");
  if (minutes < 60) return t("line.minutes", { n: minutes });
  return t("line.hours", { n: Math.floor(minutes / 60) });
}

/** What every row of a group shares (shown once, in its header); null where the rows differ. */
export function sharedMeta(rows: HubRow[]): {
  hostName: string | null;
  origin: HubOrigin | null;
} {
  const [first] = rows;
  if (!first) return { hostName: null, origin: null };
  return {
    hostName: rows.every((r) => r.hostName === first.hostName) ? first.hostName : null,
    origin: rows.every((r) => r.origin === first.origin) ? first.origin : null,
  };
}

/** How many rows the hub draws before "show more": the DOM of 9,000 sessions is not worth drawing. */
export const HUB_ROW_CAP = 200;

/** The groups cut to their first `limit` rows in display order, and how many rows were left out. */
export function capGroups(
  groups: HubGroup[],
  limit: number,
): { groups: HubGroup[]; hidden: number } {
  let left = limit;
  const kept: HubGroup[] = [];
  for (const group of groups) {
    if (left <= 0) break;
    kept.push(group.rows.length <= left ? group : { ...group, rows: group.rows.slice(0, left) });
    left -= group.rows.length;
  }
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { groups: kept, hidden: Math.max(0, total - limit) };
}
