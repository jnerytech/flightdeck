import type { Card, WatchInfo } from "@flightdeck/protocol";
import type { AppState } from "./app-store.ts";

/** One open pull request: the card that holds it, and where that card lives. */
export interface PullRequestRow {
  hostId: string;
  hostName: string;
  projectName: string;
  card: Card;
}

/** 0 for what needs a look (failing checks, a watch that gave up), 1 while waiting, 2 for the rest. */
function attention(card: Card, watch: WatchInfo | undefined): number {
  if (card.checksState === "failing" || watch?.status === "needs_you") return 0;
  return card.checksState === "pending" ? 1 : 2;
}

/**
 * Every card with an open PR on the online hosts, the ones that need a look first, then by host and
 * title. The cards are the board's: the PR polling keeps them current, so this asks nothing.
 */
export function openPullRequests(
  state: Pick<AppState, "hosts" | "projects" | "cards" | "watches">,
): PullRequestRow[] {
  const online = new Map(
    state.hosts.filter((host) => host.status === "online").map((host) => [host.id, host]),
  );
  const found: Array<{ rank: number; row: PullRequestRow }> = [];
  for (const [key, card] of Object.entries(state.cards)) {
    if (card.prState !== "open" || !card.prUrl) continue;
    // The key is `<host>/<card>`: the host is what comes before the card's own id.
    const suffix = `/${card.id}`;
    const host = key.endsWith(suffix) ? online.get(key.slice(0, -suffix.length)) : undefined;
    if (!host) continue;
    const projectName = state.projects[host.id]?.find((p) => p.id === card.projectId)?.name ?? "";
    found.push({
      rank: attention(card, state.watches[key]),
      row: { hostId: host.id, hostName: host.name, projectName, card },
    });
  }
  return found
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.row.hostName.localeCompare(b.row.hostName) ||
        a.row.card.title.localeCompare(b.row.card.title),
    )
    .map((entry) => entry.row);
}
