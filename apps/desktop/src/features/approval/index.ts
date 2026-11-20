/**
 * The devices that approve for the person, public entry (#3439, #1589): this device's key per host,
 * the proof of a high-risk allow, and enrolling and revoking. Another domain imports from here.
 */
export {
  type ApprovalCore,
  ApprovalSlice,
  type ApprovalStatus,
  type ProofAnswer,
  type ProofResult,
} from "./store.ts";
