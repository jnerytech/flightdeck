/** Issue #1705: what a stored conversation is waiting for the person to answer, if its tail says so. */
import type { HistoryMessage } from "@flightdeck/protocol";

export type Awaiting = "plan" | "question";

/** The answer a conversation waits for at its tail: `null` for none. */
export function awaitingApproval(_messages: readonly HistoryMessage[]): Awaiting | null {
  return null;
}
