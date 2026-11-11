/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions a
 * restart interrupted, the session summaries a host sends, and the commands a person asks of a
 * session. Another domain imports from here, never a file inside.
 */

export { SessionCommandsSlice } from "./commands.ts";
export { byProject, CONTINUATION } from "./resume-offer.ts";
export { ResumeOfferDialog } from "./resume-offer-dialog.tsx";
export {
  initialSessionsState,
  type ResumeOffer,
  type SessionsCore,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
export { SummariesSlice } from "./summaries.ts";
