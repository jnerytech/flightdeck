/**
 * The sessions' public entry in the app (#1589, #1596): the offers to resume the sessions
 * a restart interrupted, and what a host's session summaries tell the person. Another domain imports
 * from here, never a file inside.
 */
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
