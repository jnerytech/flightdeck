import type { ActivitySinceResult } from "@flightdeck/protocol";
import type { AwayState } from "./app-store.ts";

/** What one host has to say about the time the app was closed. */
export interface AwayNews {
  hostId: string;
  hostName: string;
  result: ActivitySinceResult;
}

/** The "While you were away" summary: the hosts with news, and the ones that did not answer. */
export interface AwayView {
  since: string;
  news: AwayNews[];
  /** Names of the hosts asked that did not answer. */
  unreached: string[];
}

/** The summary to show, or null when there is none: no absence, closed by the person, or nothing new. */
export function awayView(
  _away: AwayState & { unreached?: string[] },
  _hosts: ReadonlyArray<{ id: string; name: string }>,
): AwayView | null {
  return { since: "", news: [], unreached: [] };
}
