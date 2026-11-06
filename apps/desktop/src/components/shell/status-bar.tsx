import type { T } from "@/i18n/index";
import type { AppState } from "@/lib/app-store";
import type { QuotaGlance } from "@/lib/quota-glance";
import type { Route } from "@/lib/router";
import type { StatusBarSummary } from "@/lib/status-bar";

/**
 * The slim bar at the bottom of the window (issue #491). Left: the plan quota with its reset time
 * and a refresh. Right: keep-awake, terminals, hosts and the app's update. Each one opens its page
 * (stub: draws nothing yet).
 */
export function StatusBar(
  props: Readonly<{
    t: T;
    quota: { glance: QuotaGlance; hostName: string } | null;
    refreshing: boolean;
    summary: StatusBarSummary;
    onRefreshQuota(): void;
    onOpenQuota(hostId: string): void;
    onOpenKeepAwake(hostId: string): void;
    onOpenTerminals(): void;
    onOpenHosts(): void;
    onOpenUpdate(): void;
  }>,
) {
  return <section data-slot="status-bar" aria-label={props.t("statusBar.label")} />;
}

/** The plan quota at a glance, as one button of the bar (issue #118; stub: draws nothing yet). */
export function QuotaGlanceButton(
  _props: Readonly<{
    t: T;
    glance: QuotaGlance | null;
    hostName: string;
    onOpen(hostId: string): void;
  }>,
) {
  return null;
}

/** The bar over the app's state: the quota glance of the online hosts, the counts and the update (stub: draws nothing yet). */
export function StatusBarSlot(
  _props: Readonly<{
    t: T;
    state: Pick<AppState, "hosts" | "quota" | "appUpdate" | "settings">;
    now: number;
    terminalTabs: number;
    refreshing: boolean;
    onRefreshQuota(): void;
    onOpenTerminals(): void;
    go(route: Route): void;
  }>,
) {
  return null;
}
