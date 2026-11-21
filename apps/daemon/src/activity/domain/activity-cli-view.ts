/**
 * Issue #3736: what `flightdeckd activity since` says, as pure rules over the daemon's answer. The terminal-control
 * scrub is the runner's (`said`, `json`).
 */
import type { ActivityList, ActivitySinceResult } from "@flightdeck/protocol";

export interface ActivityCliArgs {
  /** The instant, in UTC, as the daemon takes it. */
  since: string;
  limit?: number;
  json?: boolean;
}

/** A section's heading: the count, as `n of m` when the daemon cut the list to its newest. */
const heading = (label: string, list: ActivityList<unknown>) =>
  `${label}: ${list.items.length < list.total ? `${list.items.length} of ${list.total}` : list.total}`;

const percent = (share: number | null) =>
  share === null ? "unknown" : `${Math.round(share * 100)}%`;

export function activityLines(result: ActivitySinceResult): string[] {
  const { sessions, reviewCards, prs, failedRuns, quota } = result;
  const lists = [sessions.total, reviewCards.total, prs.total, failedRuns.total];
  const lines = [`since ${result.since}`];
  if (lists.every((total) => total === 0)) lines.push("nothing happened since then");
  else {
    const section = <T>(label: string, list: ActivityList<T>, line: (item: T) => string) => {
      if (list.total > 0)
        lines.push(heading(label, list), ...list.items.map((i) => `  ${line(i)}`));
    };
    section(
      "sessions ended",
      sessions,
      (s) => `${s.id} ${s.name ?? "(unnamed)"}, ${s.cwd}, ${s.at}`,
    );
    section("cards in review", reviewCards, (c) => `${c.cardId} ${c.title}, ${c.at}`);
    section(
      "pull requests",
      prs,
      (p) => `${p.cardId} ${p.title}, ${p.outcome}, ${p.prUrl}, ${p.at}`,
    );
    section(
      "failed runs",
      failedRuns,
      (r) =>
        `${r.runId} ${r.workflowName} on card ${r.cardId}, ${r.reasonKey ?? "failed"}, ${r.at}`,
    );
  }
  if (quota.length > 0)
    lines.push(`quota: ${quota.map((q) => `${q.window} ${percent(q.utilization)}`).join(", ")}`);
  return lines;
}

/** The keys a script reads: every list with its total, and null for what an older host leaves out. */
export const activityJson = (result: ActivitySinceResult) => ({
  since: result.since,
  sessions: {
    total: result.sessions.total,
    items: result.sessions.items.map(({ id, name, cwd, at }) => ({
      id,
      name: name ?? null,
      cwd,
      at,
    })),
  },
  reviewCards: result.reviewCards,
  prs: result.prs,
  failedRuns: {
    total: result.failedRuns.total,
    items: result.failedRuns.items.map((run) => ({
      runId: run.runId,
      cardId: run.cardId,
      projectId: run.projectId ?? null,
      workflowName: run.workflowName,
      reasonKey: run.reasonKey ?? null,
      reasonParams: run.reasonParams ?? null,
      at: run.at,
    })),
  },
  quota: result.quota,
});
