import type { Waiting } from "./secret-use.ts";

/** How long the Approve button of a prod or high-risk request is held. */
const HOLD_MS = 2000;

/** What the app or the tray sends when the person approves a request that asked. */
export interface Approval {
  via: "app" | "tray";
  heldMs?: number;
  scope?: "once" | "session";
}

/** Why an approval is refused: the English message and the reason key the app translates. */
export interface ApprovalRefusal {
  message: string;
  reason: string;
}

/** The first rule an approval of this waiting request breaks, or null when it may go through. */
export function approvalRefusal(waiting: Waiting, approval: Approval): ApprovalRefusal | null {
  if (waiting.decision !== "ask") {
    return { message: "the request needs no approval", reason: "action_no_approval_needed" };
  }
  if (waiting.needsHold) {
    if (approval.via === "tray") {
      return {
        message: "the tray does not approve prod or high-risk requests: approve in the app",
        reason: "action_tray_refused",
      };
    }
    if ((approval.heldMs ?? 0) < HOLD_MS) {
      return { message: "hold the Approve button for 2 s", reason: "action_hold_needed" };
    }
    // An approval for the session would let the next uses through without the button held.
    if (approval.scope === "session") {
      return {
        message: "a prod or high-risk request is not approved for the session: one use at a time",
        reason: "action_session_refused_risky",
      };
    }
  }
  if (approval.scope === "session" && !waiting.once) {
    return {
      message: "the rule does not allow approving for the session: this request asks on every use",
      reason: "action_session_refused_rule",
    };
  }
  return null;
}
