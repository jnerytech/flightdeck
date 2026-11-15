/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions a
 * restart interrupted, the session summaries a host sends, the Claude sessions started in a
 * terminal, the lists the Sessions screen shows from the hosts, what its events do to the
 * conversations, the commands a person asks of a session, and the question a person answers before
 * a second `claude` opens on a conversation another terminal holds, a session's status badge, and the
 * list and cards toggle the hub and the history list share, and the helpers around a session: the
 * hosts a session starts on, its timing and cost, the follow and draft hooks, the mode and model menus.
 * Another domain imports from here, never a file inside.
 */

export { browserClockDeps, CacheTimerSettings, SharedClock } from "./cache-timer-model.ts";
export { SessionCommandsSlice } from "./commands.ts";
export { fillComposer, takeComposerFill } from "./composer-fill.ts";
export { awaitingApproval } from "./domain/awaiting-approval.ts";
export type { CacheTtl } from "./domain/cache-timer.ts";
export { type Finish, sinceLastLook } from "./domain/finished-list.ts";
export {
  type HubFilter,
  type HubRow,
  type HubRowState,
  type HubView,
  hubRows,
  isOver,
  loadHubFilter,
  loadHubOpen,
  loadHubView,
  saveHubFilter,
  saveHubOpen,
  saveHubView,
  takeHubHost,
} from "./domain/hub.ts";
export { groupName, hubRowOrder } from "./domain/hub-groups.ts";
export { sessionLineText } from "./domain/hub-status.ts";
export { newSessionHost } from "./domain/new-session-host.ts";
export { CONTINUATION } from "./domain/resume-offer.ts";
export { rowRoute } from "./domain/row-route.ts";
export type { Selection } from "./domain/selection.ts";
export { sessionKey } from "./domain/session-key.ts";
export { sessionLabel } from "./domain/session-label.ts";
export type { SessionState } from "./domain/session-state.ts";
export {
  hiddenTiles,
  lastLines,
  loadTileLayout,
  pendingOf,
  pickTiles,
  saveTileLayout,
  TILE_LAYOUTS,
  type TileLayout,
  tileColumns,
} from "./domain/session-tiles.ts";
export {
  type SessionView as SessionViewName,
  SessionViews,
  VIEW_LABEL,
} from "./domain/session-views.ts";
export { elsewhereNotice, waitingCards } from "./domain/start-elsewhere.ts";
export { sessionTabOffers } from "./domain/tab-offers.ts";
export { formatMs } from "./domain/timing.ts";
export { inputSummary } from "./domain/tool-input.ts";
export { messageParts } from "./domain/tool-line.ts";
export { type Turn, turnsOf } from "./domain/turns.ts";
export { ExternalSessionsSlice } from "./external.ts";
export { FinishedSlice } from "./finished.ts";
export { toolLoader } from "./history-tool.ts";
export { HISTORY_LIST_LIMIT, SessionListsSlice } from "./lists.ts";
export { NewSessionPrefs } from "./new-session-prefs.ts";
export type { SessionActions } from "./session-actions.ts";
export {
  initialSessionsState,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
export { SessionStreamSlice } from "./stream.ts";
export type { SessionSubscriptions } from "./subscriptions.ts";
export { SummariesSlice } from "./summaries.ts";
export { useDraft } from "./use-draft.ts";
export { useFollow } from "./use-follow.ts";
export { useSessionCost } from "./use-session-cost.ts";
export { useStartElsewhere } from "./use-start-elsewhere.ts";
export {
  wireExternalSessions,
  wireFinished,
  wireSessionActions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessionSubscriptions,
  wireSessions,
  wireSummaries,
} from "./wire.ts";
