import type { Card } from "@flightdeck/protocol";

/** The one thing a card asks of the person next, shown as its primary button. */
export type NextStep = "start" | "stop" | "review" | "open-pr" | "merge-pr";

type Shape = Pick<
  Card,
  "worktreePath" | "sessionId" | "sessionStatus" | "queued" | "prUrl" | "prState"
>;

/** The card's next step, from its state and what the page shows. `null`: nothing is waiting on the person. */
export function nextStep(
  _card: Shape,
  _view: { tab: "conversation" | "diff"; canMerge: boolean },
): NextStep | null {
  return null;
}

/** A finished run with work in its worktree and no PR yet: the card opens on its changes. */
export function opensOnChanges(_card: Shape): boolean {
  return false;
}
