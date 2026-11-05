import type {
  ExternalStatus,
  SessionLine,
  SessionMeta,
  SessionPersona,
  SessionStatus,
} from "@flightdeck/protocol";
import { type T, translator } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";
import { rowTitle } from "./hub-title.ts";
import { basename } from "./paths.ts";

const PT = translator("pt-BR");

export type HubOrigin = "flightdeck" | "terminal" | "history" | "background";
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

const ORIGINS: readonly string[] = ["", "flightdeck", "terminal", "history", "background"];
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

/** How the hub draws its sessions: one line each, or one card each. */
export type HubView = "list" | "cards";

/** Where the hub's view is kept. */
export const HUB_VIEW_KEY = "flightdeck.hubView";

/** The stored view; anything unreadable is the list. */
export function loadHubView(storage: { getItem(key: string): string | null }): HubView {
  return storage.getItem(HUB_VIEW_KEY) === "cards" ? "cards" : "list";
}

export function saveHubView(
  storage: { setItem(key: string, value: string): void },
  view: HubView,
): void {
  storage.setItem(HUB_VIEW_KEY, view);
}

export interface HubGroup {
  key: string;
  /**
   * What the fold state is kept under. Unlike `key` it does not depend on which rows are there:
   * a host going offline or two folders merging leave it as it was.
   */
  foldKey: string;
  /** Repository name (or folder) shown on the group. */
  name: string;
  /** Where the project is, when another group has the same name; else absent. */
  hint?: string;
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

/** What a background session's state means for the hub. */
const BACKGROUND: Record<string, HubState> = {
  working: "running",
  blocked: "needs_you",
  done: "idle",
  failed: "ended",
  stopped: "ended",
};

const NO_META: SessionMeta = { name: null, pinned: false, archived: false };

/**
 * Every session of every host: managed ones (live status from the summaries), external ones
 * (from hooks) and the history, each claudeSessionId once (managed, then external, then history).
 */
/** The parts of the state the rows are made of. */
export type HubRowState = Pick<
  AppState,
  "hosts" | "hub" | "meta" | "externals" | "names" | "background"
>;

export function hubRows(state: HubRowState): HubRow[] {
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
        title: rowTitle({
          name,
          title: s.name,
          persona: s.persona ?? null,
          request: s.summary?.request ?? null,
          cwd: s.cwd,
        }),
        state: MANAGED[live?.status ?? s.status],
        controllable: false,
        lastActivity: live?.updatedAt ?? s.updatedAt,
        summary: liveLine(s.summary, live),
        persona: s.persona ?? null,
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
    const externals = Object.entries(state.externals)
      .filter(([key, s]) => key.startsWith(`${host.id}/`) && !seen.has(s.claudeSessionId))
      .map(([, s]): HubRow => {
        const { name, ...common } = base(s.claudeSessionId, s.cwd ?? "", s.projectKey);
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
            cwd: s.cwd ?? s.claudeSessionId,
          }),
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

const matches = (row: HubRow, filter: HubFilter) =>
  `${row.title}\n${row.cwd}\n${row.hostName}\n${groupName(row.projectKey)}`
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

const isFolderKey = (key: string) => key.startsWith("host:");

/** The folder names that two folders of one host share: those never join, on any host. */
function ambiguousNames(rows: HubRow[]): Set<string> {
  const folders = new Map<string, Set<string>>();
  for (const { projectKey, hostName } of rows) {
    if (!isFolderKey(projectKey)) continue;
    const id = `${hostName}\n${groupName(projectKey)}`;
    folders.set(id, (folders.get(id) ?? new Set()).add(projectKey));
  }
  return new Set(
    [...folders].filter(([, keys]) => keys.size > 1).map(([id]) => id.split("\n")[1] as string),
  );
}

/**
 * What makes two rows one project. A key the daemon resolved (a remote) is shared by the hosts
 * already; a folder key (`host:<name>:<path>`) is per host, so the same folder name on two hosts
 * joins as one project, unless one host has two folders of that name.
 */
const mergeKey = (key: string, ambiguous: Set<string>) =>
  isFolderKey(key) && !ambiguous.has(groupName(key)) ? `folder:${groupName(key)}` : key;

/** The path above a project's name, `depth` segments of it: "work" for /home/a/work/api. */
function pathHint(key: string, depth: number): string {
  const path = key.replace(/^host:[^:]*:/, "");
  const parts = path.split(/[\\/]/).filter(Boolean);
  // A remote reads as owner and place: all of it above the name.
  if (!isFolderKey(key)) return parts.slice(0, -1).join("/");
  return parts.slice(Math.max(0, parts.length - 1 - depth), -1).join("/");
}

/** Groups that share a name say where they are, with as many path segments as it takes to differ. */
function withHints(groups: HubGroup[]): HubGroup[] {
  const byName = new Map<string, HubGroup[]>();
  for (const group of groups) byName.set(group.name, [...(byName.get(group.name) ?? []), group]);
  const hints = new Map<string, string>();
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    let depth = 1;
    const at = () => same.map((g) => pathHint(g.key, depth));
    while (new Set(at()).size < same.length && depth < 8) depth++;
    const found = at();
    for (const [i, g] of same.entries()) hints.set(g.key, found[i] as string);
  }
  return groups.map((g) => (hints.has(g.key) ? { ...g, hint: hints.get(g.key) } : g));
}

/**
 * Filtered rows by project; the ones that need you first, then pinned, then the standard names
 * in order (phase 21: only hosts with names give them), then latest activity; groups by latest
 * activity.
 */
export function hubGroups(rows: HubRow[], filter: HubFilter): HubGroup[] {
  const byKey = new Map<string, HubRow[]>();
  const ambiguous = ambiguousNames(rows);
  for (const row of rows.filter((r) => matches(r, filter))) {
    const merged = mergeKey(row.projectKey, ambiguous);
    const list = byKey.get(merged);
    if (list) list.push(row);
    else byKey.set(merged, [row]);
  }
  const order = (a: HubRow, b: HubRow) =>
    Number(b.state === "needs_you") - Number(a.state === "needs_you") ||
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.standardName != null) - Number(a.standardName != null) ||
    (a.standardName ?? "").localeCompare(b.standardName ?? "", undefined, { numeric: true }) ||
    b.lastActivity.localeCompare(a.lastActivity);
  return withHints(
    [...byKey.entries()]
      .map(([, list]) => {
        // A stable key whichever row is newest: the smallest project key among the rows.
        const key = list.map((r) => r.projectKey).reduce((x, y) => (y < x ? y : x));
        return { key, foldKey: key, name: groupName(key), rows: [...list].sort(order) };
      })
      .sort((a, b) => (b.rows[0]?.lastActivity ?? "").localeCompare(a.rows[0]?.lastActivity ?? "")),
  );
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

/** Where the open or folded state of each project is kept (issue #111). */
export const HUB_OPEN_KEY = "flightdeck.hubOpen";

/** The projects the person opened or folded last time, by project key; anything unreadable is none. */
export function loadHubOpen(storage: {
  getItem(key: string): string | null;
}): Record<string, boolean> {
  try {
    const stored = JSON.parse(storage.getItem(HUB_OPEN_KEY) ?? "{}") as unknown;
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

export function saveHubOpen(
  storage: { setItem(key: string, value: string): void },
  open: Record<string, boolean | undefined>,
): void {
  const chosen = Object.entries(open).filter(
    (entry): entry is [string, boolean] => entry[1] !== undefined,
  );
  storage.setItem(HUB_OPEN_KEY, JSON.stringify(Object.fromEntries(chosen)));
}

/** A project group as the screen draws it: folded, with its history behind a count. */
export interface HubGroupView {
  group: HubGroup;
  /** Live and needs-you sessions, in the group's order. */
  live: HubRow[];
  /** How many sessions the project has in all (the live ones are `live.length`). */
  total: number;
  /** Sessions that ended or come from the history, newest first. */
  earlier: HubRow[];
  expanded: boolean;
  earlierShown: boolean;
  /** What is drawn: nothing when folded, else the live ones and, when asked for, the earlier ones. */
  rows: HubRow[];
}

/**
 * Each group as drawn. A group is open when the person said so, else when a search is on, and
 * folded it shows only the sessions that need you; its earlier sessions come behind a count unless asked for (or searching).
 */
export function hubView(
  groups: HubGroup[],
  open: Record<string, boolean | undefined>,
  earlierOpen: Record<string, boolean | undefined>,
  searching: boolean,
): HubGroupView[] {
  return groups.map((group) => {
    // A pinned session is one the person wants close: it stays with the live ones.
    const isEarlier = (r: HubRow) => !r.pinned && (r.origin === "history" || r.state === "ended");
    const earlier = group.rows
      .filter(isEarlier)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    const live = group.rows.filter((r) => !isEarlier(r));
    // Every project starts folded (the list gets long); a search or filter opens what it keeps.
    const expanded = open[group.key] ?? searching;
    const earlierShown = searching || earlierOpen[group.key] === true;
    return {
      group,
      live,
      total: group.rows.length,
      earlier,
      expanded,
      earlierShown,
      // Folded, the sessions that need you stay in view: they are the reason to look.
      rows: expanded
        ? [...live, ...(earlierShown ? earlier : [])]
        : live.filter((r) => r.state === "needs_you"),
    };
  });
}

/** Whether the filter narrows the list on purpose, so what it keeps is shown, not folded away. */
export function isSearching(filter: HubFilter): boolean {
  return (
    filter.text.trim() !== "" ||
    filter.host !== "" ||
    filter.origin !== "" ||
    filter.state !== "" ||
    filter.persona !== "" ||
    filter.pinnedOnly
  );
}

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
