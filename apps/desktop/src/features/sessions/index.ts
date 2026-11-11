/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions a
 * restart interrupted, the session summaries a host sends, the Claude sessions started in a
 * terminal, the lists the Sessions screen shows from the hosts, what its events do to the
 * conversations, and the commands a person asks of a session. Another domain imports from here, never a file inside.
 */

export { SessionCommandsSlice } from "./commands.ts";
export { ExternalSessionsSlice } from "./external.ts";
export {
  awayHost,
  hubProjectKeys,
  projectChoices,
  projectName,
  rowsInScope,
  scopeKeys,
} from "./hub-scope.ts";
export { HISTORY_LIST_LIMIT, SessionListsSlice } from "./lists.ts";
export { byProject, CONTINUATION } from "./resume-offer.ts";
export { ResumeOfferDialog } from "./resume-offer-dialog.tsx";
export {
  initialSessionsState,
  type ResumeOffer,
  type SessionsCore,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
export { SessionStreamSlice } from "./stream.ts";
export { SummariesSlice } from "./summaries.ts";
export {
  wireExternalSessions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessions,
  wireSummaries,
} from "./wire.ts";
