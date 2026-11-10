import type { ActivitySinceResult } from "@flightdeck/protocol";
import type { AwayState } from "./store.ts";

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

const newsOf = (result: ActivitySinceResult) =>
  result.sessions.total + result.reviewCards.total + result.prs.total + result.failedRuns.total;

/**
 * The summary to show, or null when there is none: no absence, closed by the person, or nothing
 * new. A host with nothing new is left out (its quota alone is not news); one that did not answer
 * is named.
 */
export function awayView(
  away: AwayState,
  hosts: ReadonlyArray<{ id: string; name: string }>,
): AwayView | null {
  if (away.since === null || away.dismissed) return null;
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name ?? id;
  const news = away.hosts
    .filter((host) => newsOf(host.result) > 0)
    .map((host) => ({ hostId: host.hostId, hostName: nameOf(host.hostId), result: host.result }));
  const unreached = away.unreached.map(nameOf);
  if (news.length === 0 && unreached.length === 0) return null;
  return { since: away.since, news, unreached };
}
