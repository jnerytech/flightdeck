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

export { awaitingApproval } from "./awaiting-approval.ts";
export {
  browserClockDeps,
  CacheTimerSettings,
  type CacheTtl,
  SharedClock,
} from "./cache-timer-model.ts";
export { SessionCommandsSlice } from "./commands.ts";
export { ExternalSessionsSlice } from "./external.ts";
export {
  type Finish,
  FinishedSlice,
  sinceLastLook,
} from "./finished.ts";
export { toolLoader } from "./history-tool.ts";
export {
  groupName,
  type HubFilter,
  type HubRow,
  type HubRowState,
  type HubState,
  type HubView,
  hubRowOrder,
  hubRows,
  isOver,
  loadHubFilter,
  loadHubOpen,
  loadHubView,
  saveHubFilter,
  saveHubOpen,
  saveHubView,
  sessionLineText,
  takeHubHost,
} from "./hub.ts";
export { HISTORY_LIST_LIMIT, SessionListsSlice } from "./lists.ts";
export { newSessionHost } from "./new-session-host.ts";
export { NewSessionPrefs } from "./new-session-prefs.ts";
export { pendingText, pendingWhere } from "./pending-text.ts";
export { byProject, CONTINUATION } from "./resume-offer.ts";
export { ResumeOfferDialog } from "./resume-offer-dialog.tsx";
export { rowRoute } from "./row-route.ts";
export { sessionKey } from "./session-key.ts";
export { sessionLabel } from "./session-label.ts";
export type { SessionState } from "./session-state.ts";
export { type SessionActions, SessionView } from "./session-view.tsx";
export { type SessionView as SessionViewName, SessionViews, VIEW_LABEL } from "./session-views.ts";
export { elsewhereNotice, waitingCards } from "./start-elsewhere.ts";
export { StatusBadge } from "./status-badge.tsx";
export {
  initialSessionsState,
  type ResumeOffer,
  type SessionsCore,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
export { SessionStreamSlice } from "./stream.ts";
export type { SessionSubscriptions } from "./subscriptions.ts";
export { SummariesSlice } from "./summaries.ts";
export { sessionTabOffers } from "./tab-offers.ts";
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
} from "./tiles.ts";
export { formatMs } from "./timing.ts";
export { inputSummary } from "./tool-input.ts";
export { messageParts } from "./tool-line.ts";
export { type Turn, turnsOf } from "./turns.ts";
export { useDraft } from "./use-draft.ts";
export { useFollow } from "./use-follow.ts";
export { useLiveElsewhereAsk, useLiveElsewhereGuard } from "./use-live-elsewhere-guard.tsx";
export { useSessionCost } from "./use-session-cost.ts";
export { useStartElsewhere } from "./use-start-elsewhere.ts";
export { ViewToggle } from "./view-toggle.tsx";
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
