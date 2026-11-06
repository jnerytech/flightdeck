import {
  ArrowUpCircle,
  CircleAlert,
  Coffee,
  Moon,
  RefreshCw,
  Server,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { Meter } from "@/components/status/meter";
import type { Key, T } from "@/i18n/index";
import type { AppState } from "@/lib/app-store";
import { type QuotaGlance, quotaGlance } from "@/lib/quota-glance";
import type { Route } from "@/lib/router";
import { hostsRoute, type StatusBarSummary, statusBarSummary } from "@/lib/status-bar";

/** One button of the bar: its words are the name, the tooltip repeats them, never colour alone. */
function Item(
  props: Readonly<{ name: string; tip?: string; onClick(): void; children: ReactNode }>,
) {
  return (
    <IconTip label={props.tip ?? props.name}>
      <button type="button" aria-label={props.name} className="status-item" onClick={props.onClick}>
        {props.children}
      </button>
    </IconTip>
  );
}

/**
 * The plan quota at a glance (issue #118): the window under most pressure across the online hosts,
 * as a small meter, its percent and the time left. Its name says the state in words, the host and
 * when it resets; near or at the limit a mark shows too. Pressing it opens that host.
 */
export function QuotaGlanceButton(
  props: Readonly<{
    t: T;
    glance: QuotaGlance | null;
    hostName: string;
    onOpen(hostId: string): void;
  }>,
) {
  const { t, glance } = props;
  if (!glance) return null;
  const window = t(`account.windows.${glance.window}` as Key);
  const vars = {
    state: t(`shell.quotaLevels.${glance.level}` as Key),
    window,
    percent: String(glance.percent),
    host: props.hostName,
    remaining: glance.remaining,
  };
  const name = glance.remaining ? t("shell.quotaLabel", vars) : t("shell.quotaLabelNoReset", vars);
  return (
    <IconTip label={name}>
      <button
        type="button"
        aria-label={name}
        data-level={glance.level}
        className="status-item status-quota"
        onClick={() => props.onOpen(glance.hostId)}
      >
        {glance.level !== "ok" && <CircleAlert aria-hidden="true" data-mark="" />}
        <span className="status-quota-window">{window}</span>
        <Meter
          label={window}
          value={Math.min(glance.percent, 100)}
          max={100}
          hot={glance.level === "reached"}
          className="status-meter"
        />
        <span>{glance.percent}%</span>
        {glance.remaining && <span className="status-quota-reset">{glance.remaining}</span>}
      </button>
    </IconTip>
  );
}

/**
 * The slim bar at the bottom of the window (issue #491). Left: the plan quota with its reset time
 * and a refresh. Right: keep-awake, terminals, hosts and the app's update. Each one opens its page;
 * what no host reports is not drawn.
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
  const { t, summary } = props;
  const refreshName = props.refreshing
    ? t("statusBar.refreshingQuota")
    : t("statusBar.refreshQuota");
  const awake = summary.keepAwake;
  const AwakeIcon = awake === "off" ? Moon : Coffee;
  const terminalsName =
    summary.terminals === 1
      ? t("statusBar.terminalsOne")
      : t("statusBar.terminals", { n: String(summary.terminals) });
  const hostsVars = { online: String(summary.hostsOnline), total: String(summary.hostsTotal) };
  const hostsName =
    summary.hostsTotal === 1 ? t("statusBar.hostsOne", hostsVars) : t("statusBar.hosts", hostsVars);
  const update = summary.update;
  const version = summary.updateVersion ?? "";
  const UpdateIcon = update === "failed" ? TriangleAlert : ArrowUpCircle;
  return (
    <section data-slot="status-bar" aria-label={t("statusBar.label")} className="status-bar">
      <div className="status-bar-group">
        {props.quota && (
          <>
            <QuotaGlanceButton
              t={t}
              glance={props.quota.glance}
              hostName={props.quota.hostName}
              onOpen={props.onOpenQuota}
            />
            <IconTip label={refreshName}>
              <button
                type="button"
                aria-label={refreshName}
                aria-busy={props.refreshing}
                disabled={props.refreshing}
                className="status-item status-refresh"
                data-busy={props.refreshing}
                onClick={props.onRefreshQuota}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </IconTip>
          </>
        )}
      </div>
      <div className="status-bar-group">
        {update && (
          <Item
            name={t(`statusBar.update.${update}` as Key, { version })}
            onClick={props.onOpenUpdate}
          >
            <UpdateIcon aria-hidden="true" data-mark="" />
            <span>{t(`statusBar.updateShort.${update}` as Key, { version })}</span>
          </Item>
        )}
        {awake && summary.keepAwakeHostId && (
          <Item
            name={t(`statusBar.keepAwake.${awake}` as Key)}
            onClick={() => props.onOpenKeepAwake(summary.keepAwakeHostId as string)}
          >
            <AwakeIcon aria-hidden="true" />
            <span>{t(`statusBar.keepAwakeShort.${awake}` as Key)}</span>
          </Item>
        )}
        <Item name={terminalsName} onClick={props.onOpenTerminals}>
          <SquareTerminal aria-hidden="true" />
          <output>{summary.terminals}</output>
        </Item>
        <Item name={hostsName} onClick={props.onOpenHosts}>
          <Server aria-hidden="true" />
          <output>
            {summary.hostsOnline}/{summary.hostsTotal}
          </output>
        </Item>
      </div>
    </section>
  );
}

/** The bar over the app's state: the quota glance of the online hosts, the counts and the update. */
export function StatusBarSlot(
  props: Readonly<{
    t: T;
    state: Pick<AppState, "hosts" | "quota" | "appUpdate" | "settings">;
    now: number;
    terminalTabs: number;
    refreshing: boolean;
    /** The host in view, which the hosts item opens when every host is online. */
    currentHostId?: string | null;
    onRefreshQuota(): void;
    onOpenTerminals(): void;
    go(route: Route): void;
  }>,
) {
  const { state, go } = props;
  const online = state.hosts.filter((host) => host.status === "online");
  const glance = quotaGlance(
    state.quota,
    online.map((host) => host.id),
    props.now,
  );
  const quotaHost = online.find((host) => host.id === glance?.hostId);
  const toHost = (host: string) => go({ name: "host", host });
  return (
    <StatusBar
      t={props.t}
      quota={glance ? { glance, hostName: quotaHost?.name ?? "" } : null}
      refreshing={props.refreshing}
      summary={statusBarSummary(state, props.terminalTabs)}
      onRefreshQuota={props.onRefreshQuota}
      onOpenQuota={toHost}
      onOpenKeepAwake={toHost}
      onOpenTerminals={props.onOpenTerminals}
      onOpenHosts={() => go(hostsRoute(state.hosts, props.currentHostId ?? null))}
      onOpenUpdate={() => go({ name: "settings" })}
    />
  );
}
