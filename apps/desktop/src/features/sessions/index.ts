/**
 * The sessions' public entry in the app (#1589, #1596): for now, the offers to resume the sessions
 * a restart interrupted. Another domain imports from here, never a file inside.
 */
export { byProject, CONTINUATION, loadAutoResume, saveAutoResume } from "./resume-offer.ts";
export {
  initialSessionsState,
  type ResumeOffer,
  type SessionsCore,
  SessionsSlice,
  type SessionsSliceState,
} from "./store.ts";
