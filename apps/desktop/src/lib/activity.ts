import { type AppState, needsYou, type PendingItem, sessionKey } from "./app-store.ts";
import { groupName, type HubRow, hubRows } from "./hub.ts";

/** The columns of the Activity board, in order. */
export type ActivityColumn = "needs_you" | "working" | "done" | "idle";
export const ACTIVITY_COLUMNS: readonly ActivityColumn[] = ["needs_you", "working", "done", "idle"];

/** A finished turn counts as Done for this long if it was not opened. */
export const DONE_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface ActivityCard {
  column: ActivityColumn;
  row: HubRow;
  /** The repository (or folder) name of the session's project. */
  project: string;
  /** The request waiting for the person, when the session is asking and it can be answered here. */
  pending: PendingItem | null;
  /** When the session last changed, in ms. */
  changedAt: number;
}

export interface ActivityFilter {
  text: string;
  host: string;
  project: string;
  persona: string;
}

export const NO_ACTIVITY_FILTER: ActivityFilter = { text: "", host: "", project: "", persona: "" };

export interface ActivityBoardData {
  columns: Record<ActivityColumn, ActivityCard[]>;
  /** Cards that pass the filter, and all the cards of the columns on show. */
  shown: number;
  total: number;
}

/** The rows the board is about: live sessions, not the history and not what was archived. */
const live = (row: HubRow) => row.origin !== "history" && !row.archived && row.state !== "ended";

const columnOf = (row: HubRow, unread: boolean, now: number, changedAt: number): ActivityColumn => {
  if (row.state === "needs_you") return "needs_you";
  if (row.state === "running") return "working";
  return unread && now - changedAt < DONE_WINDOW_MS ? "done" : "idle";
};

/**
 * Every live session of every host in its column. Done is a finished turn nobody opened in the
 * last two hours (the app's `unread`); Idle is the rest and only comes with `showIdle`. Newest
 * change first. `shown` counts the cards that pass the filter among the columns on show.
 */
export function activityBoard(
  state: AppState,
  now: number,
  filter: ActivityFilter,
  showIdle: boolean,
): ActivityBoardData {
  const requests = needsYou(state);
  const cards: ActivityCard[] = hubRows(state)
    .filter(live)
    .map((row) => {
      const changedAt = Date.parse(row.lastActivity) || 0;
      const unread =
        row.sessionId !== null && state.unread[sessionKey(row.hostId, row.sessionId)] === true;
      const pending =
        row.state === "needs_you"
          ? (requests.find(
              (item) =>
                item.hostId === row.hostId &&
                (item.sessionId === row.sessionId || item.sessionId === row.claudeSessionId) &&
                !item.gate &&
                !item.vault &&
                item.toolName !== "AskUserQuestion",
            ) ?? null)
          : null;
      return {
        column: columnOf(row, unread, now, changedAt),
        row,
        project: groupName(row.projectKey),
        pending,
        changedAt,
      };
    })
    .filter((card) => showIdle || card.column !== "idle");
  const text = filter.text.trim().toLowerCase();
  const passes = (card: ActivityCard) =>
    (text === "" ||
      `${card.row.title}\n${card.row.hostName}\n${card.project}\n${card.row.persona?.name ?? ""}\n${card.row.summary?.request ?? ""}`
        .toLowerCase()
        .includes(text)) &&
    (!filter.host || card.row.hostName === filter.host) &&
    (!filter.project || card.project === filter.project) &&
    (!filter.persona || card.row.persona?.id === filter.persona);
  const kept = cards.filter(passes).sort((a, b) => b.changedAt - a.changedAt);
  const columns: Record<ActivityColumn, ActivityCard[]> = {
    needs_you: [],
    working: [],
    done: [],
    idle: [],
  };
  for (const card of kept) columns[card.column].push(card);
  return { columns, shown: kept.length, total: cards.length };
}

/** What the filters can pick: the hosts, projects and personas of the live sessions. */
export function activityOptions(state: AppState): {
  hosts: string[];
  projects: string[];
  personas: Array<{ id: string; name: string }>;
} {
  const rows = hubRows(state).filter(live);
  const unique = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
  const personas = new Map<string, string>();
  for (const row of rows) if (row.persona) personas.set(row.persona.id, row.persona.name);
  return {
    hosts: unique(rows.map((r) => r.hostName)),
    projects: unique(rows.map((r) => groupName(r.projectKey))),
    personas: [...personas].map(([id, name]) => ({ id, name })),
  };
}
