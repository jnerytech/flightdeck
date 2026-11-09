import type { Card, WatchInfo } from "@flightdeck/protocol";
import { formatAgo } from "../i18n/format.ts";
import type { T } from "../i18n/index.ts";
import type { AppState } from "./app-store.ts";

/** One open pull request: the card that holds it, and where that card lives. */
export interface PullRequestRow {
  hostId: string;
  hostName: string;
  projectName: string;
  card: Card;
}

/** 0 for what needs a look (failing checks, a conflict, changes asked, a watch that gave up), 1 while waiting, 2 for the rest. */
function attention(card: Card, watch: WatchInfo | undefined): number {
  if (card.checksState === "failing" || watch?.status === "needs_you") return 0;
  if (card.prMergeable === "conflict" || card.prReview === "changes_requested") return 0;
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
  found.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.row.hostName.localeCompare(b.row.hostName) ||
      a.row.card.title.localeCompare(b.row.card.title),
  );
  return found.map((entry) => entry.row);
}

/**
 * What the PR poll reports about a PR besides its checks (#1352): the merge state, the review and
 * how long it has been open, as short phrases. What the host does not report (an older host, or
 * before the first poll) gives no phrase.
 */
export function prFacts(card: Card, now: number, t: T): string[] {
  const merge = MERGE_WORDS[card.prMergeable ?? "unknown"];
  const review = REVIEW_WORDS[card.prReview ?? "none"];
  const opened = card.prOpenedAt ? Date.parse(card.prOpenedAt) : Number.NaN;
  return [
    merge && t(merge),
    review && t(review),
    Number.isNaN(opened) ? null : t("pullRequests.opened", { ago: formatAgo(now - opened, t) }),
  ].filter((phrase): phrase is string => Boolean(phrase));
}

const MERGE_WORDS = {
  clean: "pullRequests.mergeClean",
  conflict: "pullRequests.conflict",
  blocked: "pullRequests.mergeBlocked",
  unknown: null,
} as const;

const REVIEW_WORDS = {
  approved: "pullRequests.reviewApproved",
  changes_requested: "pullRequests.reviewChanges",
  required: "pullRequests.reviewRequired",
  none: null,
} as const;
