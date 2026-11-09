import type { Card } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";

/** One open pull request: the card that holds it, and where that card lives. */
export interface PullRequestRow {
  hostId: string;
  hostName: string;
  projectName: string;
  card: Card;
}

/** Every card with an open PR on the online hosts, the ones that need a look first. */
export function openPullRequests(
  _state: Pick<AppState, "hosts" | "projects" | "cards" | "watches">,
): PullRequestRow[] {
  return [];
}
