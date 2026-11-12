/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions a
 * restart interrupted, the session summaries a host sends, the Claude sessions started in a
 * terminal, the lists the Sessions screen shows from the hosts, what its events do to the
 * conversations, the commands a person asks of a session, and the question a person answers before
 * a second `claude` opens on a conversation another terminal holds, a session's status badge, and the
 * list and cards toggle the hub and the history list share.
 * Another domain imports from here, never a file inside.
 */

export { SessionCommandsSlice } from "./commands.ts";
export { ExternalSessionsSlice } from "./external.ts";
export { HISTORY_LIST_LIMIT, SessionListsSlice } from "./lists.ts";
export { byProject, CONTINUATION } from "./resume-offer.ts";
export { ResumeOfferDialog } from "./resume-offer-dialog.tsx";
export { rowRoute } from "./row-route.ts";
export { SessionView } from "./session-view.tsx";
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
export { ViewToggle } from "./view-toggle.tsx";
export {
  wireExternalSessions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessions,
  wireSummaries,
} from "./wire.ts";
