import type { Card } from "@flightdeck/protocol";
import { cardStartBlock } from "./card-start-block.ts";

/** The one thing a card asks of the person next, shown as its primary button; `gate` is answered at the gate itself. */
export type NextStep = "start" | "stop" | "review" | "open-pr" | "merge-pr" | "gate";

type Shape = Pick<
  Card,
  "worktreePath" | "sessionId" | "sessionStatus" | "queued" | "prUrl" | "prState"
>;

/** The card's next step, from its state and what the page shows. `null`: nothing is waiting on the person. */
export function nextStep(
  card: Shape,
  view: { tab: "conversation" | "diff"; canMerge: boolean; gate: boolean },
): NextStep | null {
  if (cardStartBlock(card) !== null) return "stop";
  // A run waiting at a gate is answered at the gate, where Approve and Deny are (#1269).
  if (view.gate) return "gate";
  if (card.prUrl) {
    const open = card.prState === null || card.prState === "open";
    return open && view.canMerge ? "merge-pr" : null;
  }
  if (!card.worktreePath) return "start";
  return view.tab === "diff" ? "open-pr" : "review";
}

/** A finished run with work in its worktree and no PR yet: the card opens on its changes. */
export function opensOnChanges(card: Shape): boolean {
  return cardStartBlock(card) === null && Boolean(card.worktreePath) && !card.prUrl;
}
