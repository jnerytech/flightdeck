import type { Card, WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import type { AppStore } from "../../lib/app-store.ts";

/** Issue #79: starts a post-mortem card from a failed one. */
export function PostMortem(
  _props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    run: WorkflowRun | null;
    claudeSessionId: string | null;
    workflows: WorkflowInfo[];
    onOpenCard(cardId: string): void;
  }>,
) {
  return null;
}
