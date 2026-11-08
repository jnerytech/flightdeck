import type { CostsSummary } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";
import { mergeSummaries } from "./client-costs.ts";
import { projectLabel } from "./costs.ts";
import { awayKey, type DataScope } from "./data-scope.ts";
import type { HomeHostData, HomeSnapshot } from "./home-cache.ts";
import { type HomeLeaders, homeLeaders } from "./home-leaders.ts";
import type { ConnectionStatus } from "./host-connection.ts";

/** What Home read from one online host: whether it answered, and the numbers it gave. */
export interface HostRead {
  id: string;
  /** The host has costs, so it owes the three summaries of the leaderboard. */
  priced: boolean;
  answered: boolean;
  data: HomeHostData;
  /** The three summaries, when all of them came. */
  shares: { week: CostsSummary; first: CostsSummary; second: CostsSummary } | null;
}

/** The subtitle says whose numbers they are, as the scope menu does. */
export function rangeSubtitle(
  t: T,
  scope: DataScope,
  /** The scoped host's name; a kept host that is not listed yet has none. */
  hostName: string | undefined,
  /** The name the project is shown by. */
  projectName: string | undefined,
): string {
  if (scope.kind === "all") return t("home.range");
  if (scope.kind === "project") {
    return t("home.rangeProject", { project: projectName ?? projectLabel(scope.projectKey) });
  }
  return hostName ? t("home.rangeHost", { host: hostName }) : t("home.rangeDays");
}

/** The one line the live region says until the numbers come. */
export function homeMessage(
  t: T,
  state: {
    ready: boolean;
    away: { status: ConnectionStatus; name: string } | undefined;
    connecting: boolean;
    online: number;
  },
): string {
  if (state.ready) return t("home.ready");
  if (state.away && !state.connecting) {
    return t(awayKey(state.away.status, "numbers"), { host: state.away.name });
  }
  if (state.online === 0) return state.connecting ? t("home.connecting") : t("home.noHosts");
  return t("home.loading");
}

/** A host that did not answer keeps the numbers it had, and the hosts that are offline too. */
export function keepAnswers(before: HomeSnapshot, reads: HostRead[]): HomeSnapshot {
  const hosts: HomeSnapshot = { ...before };
  for (const read of reads) {
    if (read.answered || !before[read.id]) hosts[read.id] = read.data;
  }
  return hosts;
}

/**
 * What the reads add up to: the projects of the week (every host that gave its costs, not only the
 * ones listed; null when no host gave costs), and the leaderboard. Shares from only some hosts would read as the whole, so the
 * leaderboard is `whole` only when every host with costs gave all three.
 */
export function addUp(
  reads: HostRead[],
  range: { from: string; to: string },
): { projectKeys: string[] | null; whole: boolean; leaders: HomeLeaders | null } {
  const shares = reads.flatMap((r) => (r.shares ? [{ hostId: r.id, ...r.shares }] : []));
  const merged = (part: "week" | "first" | "second") =>
    mergeSummaries(
      shares.map((s) => ({ hostId: s.hostId, summary: s[part] })),
      range.from,
      range.to,
    ).summary;
  const priced = reads.filter((r) => r.priced);
  const whole = priced.length > 0 && shares.length === priced.length;
  return {
    projectKeys: shares.length > 0 ? merged("week").byProject.map((row) => row.projectKey) : null,
    whole,
    leaders: whole ? homeLeaders(merged("week"), merged("first"), merged("second")) : null,
  };
}
