import type { WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import type { AppStore } from "@/lib/app-store";

export interface RunAgainProps {
  store: AppStore;
  hostId: string;
  cardId: string;
  run: WorkflowRun;
  /** The host's current word on the run's workflow file; `undefined` when it is not there. */
  workflow: WorkflowInfo | undefined;
  /** The host has answered `workflow.list`. */
  known: boolean;
  /** Opens the project's Workflows page, where a file is reviewed and trusted. */
  onOpenWorkflows(): void;
}

/** Issue #1219: a failed run starts again from the card, or says why it cannot. */
export function RunAgain(_props: Readonly<RunAgainProps>) {
  return null;
}
