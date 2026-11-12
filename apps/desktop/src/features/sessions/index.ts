/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions a
 * restart interrupted, the session summaries a host sends, the Claude sessions started in a
 * terminal, the lists the Sessions screen shows from the hosts, what its events do to the
 * conversations, the commands a person asks of a session, and the question a person answers before
 * a second `claude` opens on a conversation another terminal holds, a session's status badge and
 * the model choices of a form. Another domain imports from here, never a file inside.
 */

export { commandItemsOf, slashFill } from "./command-menu.ts";
export { SessionCommandsSlice } from "./commands.ts";
export { composerModeMenu, offersModelPicker } from "./composer-pickers.ts";
export { queueStep, submitAction } from "./composer-queue.ts";
export { ExternalSessionsSlice } from "./external.ts";
export { approvalRequestOf, externalRequestsOf, externalTitle } from "./external-view.ts";
export {
  costAsks,
  cursorMove,
  filterCount,
  hasBackgroundHost,
  hostlessHub,
  personasOf,
  refreshSignature,
  rowOffers,
  rowSummary,
  showsStateWord,
  worktreesOf,
} from "./hub-derive.ts";
export {
  awayHost,
  hubProjectKeys,
  projectChoices,
  projectName,
  rowsInScope,
  scopeKeys,
} from "./hub-scope.ts";
export { HISTORY_LIST_LIMIT, SessionListsSlice } from "./lists.ts";
export { ModelOptions } from "./model-options.tsx";
export {
  choicesToKeep,
  createPayload,
  joinPath,
  opensMoreOptions,
  promptMissing,
  sessionModes,
  startChoices,
  startFolder,
  underRoot,
} from "./new-session.ts";
export { byProject, CONTINUATION } from "./resume-offer.ts";
export { ResumeOfferDialog } from "./resume-offer-dialog.tsx";
export { rowRoute } from "./row-route.ts";
export { missedAfter, rememberPosition, type ScrollPosition } from "./scroll-memory.ts";
export { StatusBadge } from "./status-badge.tsx";
export {
  initialSessionsState,
  type ResumeOffer,
  type SessionsCore,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
export { SessionStreamSlice } from "./stream.ts";
export { SummariesSlice } from "./summaries.ts";
export { sessionTabOffers } from "./tab-offers.ts";
export { useLiveElsewhereAsk, useLiveElsewhereGuard } from "./use-live-elsewhere-guard.tsx";
export {
  wireExternalSessions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessions,
  wireSummaries,
} from "./wire.ts";
