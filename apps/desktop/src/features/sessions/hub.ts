import type {
  ExternalSession,
  ExternalStatus,
  HistorySessionSummary,
  SessionLine,
  SessionMeta,
  SessionStatus,
} from "@flightdeck/protocol";
import { z } from "zod";
import { readStored } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppState } from "../../lib/app-store.ts";
import type { HubFilter, HubGroup, HubOrigin, HubRow, HubState } from "./domain/hub-row.ts";
import { rowTitle } from "./domain/hub-title.ts";
import { sessionLabel } from "./domain/session-label.ts";

export type { HubFilter, HubGroup, HubOrigin, HubRow, HubState };

/** A session that is over: ended on purpose or failed (#1132). It is not live, and folds into the earlier ones. */
export function isOver(state: HubState): boolean {
  return state === "ended" || state === "failed";
}

/** Where the hub's filters are kept (not the typed text: a stale one would hide rows). */
export const HUB_FILTER_KEY = "flightdeck.hubFilter";

export const DEFAULT_HUB_FILTER: HubFilter = {
  text: "",
  origin: "",
  state: "",
  persona: "",
  pinnedOnly: false,
  showArchived: false,
};

/** The hub's kept filter, field by field: a field that is missing or unreadable falls back to its default. */
const StoredFilter = z.object({
  origin: z.enum(["", "flightdeck", "terminal", "history", "background"]).catch(""),
  state: z.enum(["", "running", "needs_you", "idle", "ended", "failed"]).catch(""),
  persona: z.string().catch(""),
  pinnedOnly: z.boolean().catch(false),
  showArchived: z.boolean().catch(false),
  /** The host kept before #126 (an older version's value that takeHubHost has not read yet). */
  host: z.string().catch(""),
});

type StoredHubFilter = z.infer<typeof StoredFilter>;

const NO_FILTER: StoredHubFilter = {
  origin: "",
  state: "",
  persona: "",
  pinnedOnly: false,
  showArchived: false,
  host: "",
};

/** The hub's kept filter as stored: a stored null, number or list is no filter. */
const storedFilter = (storage: { getItem(key: string): string | null }): StoredHubFilter =>
  readStored(storage, HUB_FILTER_KEY, StoredFilter, NO_FILTER);

/** The stored filters, field by field: anything unreadable falls back to its default. */
export function loadHubFilter(storage: { getItem(key: string): string | null }): HubFilter {
  const { host: _legacy, ...stored } = storedFilter(storage);
  return { ...stored, text: "" };
}

/** The host the hub kept in its own filter before #126, taken out of it: "" when there is none. */
export function takeHubHost(storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}): string {
  const { host, ...rest } = storedFilter(storage);
  if (host === "") return "";
  try {
    storage.setItem(HUB_FILTER_KEY, JSON.stringify(rest));
  } catch {
    // A storage that refuses: the host is still the one to use.
  }
  return host;
}

export function saveHubFilter(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  filter: HubFilter,
): void {
  const { text: _typed, ...kept } = filter;
  // A host kept by an older version that takeHubHost has not read yet stays for it (#886).
  const { host } = storedFilter(storage);
  storage.setItem(HUB_FILTER_KEY, JSON.stringify({ ...kept, ...(host === "" ? {} : { host }) }));
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
  failed: "failed",
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
> &
  Partial<Pick<AppState, "personas">>;

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

/** How many rows the hub draws before "show more": the DOM of 9,000 sessions is not worth drawing. */
export const HUB_ROW_CAP = 200;

/** Where the open or folded state of each project is kept (issue #111). */
export const HUB_OPEN_KEY = "flightdeck.hubOpen";

/** What is kept by project: a project whose value is not a boolean is dropped, the others stay. */
const StoredOpen = z
  .record(z.string(), z.unknown())
  .transform((all) =>
    Object.fromEntries(
      Object.entries(all).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    ),
  );

/** The projects the person opened or folded last time, by project key; anything unreadable is none. */
export function loadHubOpen(storage: {
  getItem(key: string): string | null;
}): Record<string, boolean> {
  return readStored(storage, HUB_OPEN_KEY, StoredOpen, {});
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
    const isEarlier = (r: HubRow) => !r.pinned && (r.origin === "history" || isOver(r.state));
    const earlier = group.rows
      .filter(isEarlier)
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    const live = group.rows.filter((r) => !isEarlier(r));
    // Every project starts folded (the list gets long); a search or filter opens what it keeps.
    // Kept under the stable key; a choice made under the project's old key still counts.
    const expanded = open[group.foldKey] ?? open[group.key] ?? searching;
    const earlierShown =
      searching || (earlierOpen[group.foldKey] ?? earlierOpen[group.key]) === true;
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

/**
 * Whether the filter narrows the list on purpose, so what it keeps is shown, not folded away. A
 * Hosts chip only chooses whose sessions the list is about: the projects stay as they were.
 */
export function isSearching(filter: HubFilter): boolean {
  return (
    filter.text.trim() !== "" ||
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
    // A project folded to nothing costs no rows: its header stays whatever the cap has left.
    if (group.rows.length === 0) kept.push(group);
    else if (left > 0) {
      kept.push(group.rows.length <= left ? group : { ...group, rows: group.rows.slice(0, left) });
      left -= group.rows.length;
    }
  }
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { groups: kept, hidden: Math.max(0, total - limit) };
}

/** How many of a project's rows are active: the ones that have not ended or failed (#1132). */
export function activeCount(rows: HubRow[]): number {
  return rows.filter((r) => !isOver(r.state)).length;
}
