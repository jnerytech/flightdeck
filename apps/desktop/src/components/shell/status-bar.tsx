import {
  ArrowUpCircle,
  CircleAlert,
  Coffee,
  Ellipsis,
  Moon,
  RefreshCw,
  Server,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { QuotaDetail } from "@/components/shell/quota-detail";
import { Meter } from "@/components/status/meter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import type { Key, T } from "@/i18n/index";
import type { AppState, AppStore } from "@/lib/app-store";
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

/** A row of the More list on a compact window: the icon and the words the bar has no room for. */
function MoreRow(
  props: Readonly<{ name: string; disabled?: boolean; onClick(): void; children: ReactNode }>,
) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className="status-item justify-start"
      onClick={props.onClick}
    >
      {props.children}
      <span>{props.name}</span>
    </button>
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
    /** What pressing it opens (issue #1218): without it, the button opens the host. */
    detail?: (close: () => void) => ReactNode;
  }>,
) {
  const { t, glance } = props;
  const [open, setOpen] = useState(false);
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
  const button = (
    <button
      type="button"
      aria-label={name}
      data-level={glance.level}
      className="status-item status-quota"
      {...(props.detail ? {} : { onClick: () => props.onOpen(glance.hostId) })}
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
  );
  if (!props.detail) return <IconTip label={name}>{button}</IconTip>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <IconTip label={name}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </IconTip>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        aria-label={t("quota.popover.label")}
        className="max-h-[70vh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
      >
        {props.detail(() => setOpen(false))}
      </PopoverContent>
    </Popover>
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
    /** What the quota opens when pressed: the hosts' windows and their guard (issue #1218). */
    quotaDetail?: (close: () => void) => ReactNode;
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
  const updateName = update ? t(`statusBar.update.${update}` as Key, { version }) : "";
  const breakpoint = useBreakpoint();
  const compact = breakpoint === "compact";
  /** The More list on a compact window; choosing a row closes it. */
  const [open, setOpen] = useState(false);
  const closing = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const keepAwake =
    awake && summary.keepAwakeHostId ? (
      <Item
        name={t(`statusBar.keepAwake.${awake}` as Key)}
        onClick={() => props.onOpenKeepAwake(summary.keepAwakeHostId as string)}
      >
        <AwakeIcon aria-hidden="true" />
        <span className="status-short">{t(`statusBar.keepAwakeShort.${awake}` as Key)}</span>
      </Item>
    ) : null;
  return (
    <section
      data-slot="status-bar"
      data-breakpoint={breakpoint}
      aria-label={t("statusBar.label")}
      className="status-bar"
    >
      <div className="status-bar-group">
        {props.quota && (
          <>
            <QuotaGlanceButton
              t={t}
              glance={props.quota.glance}
              hostName={props.quota.hostName}
              onOpen={props.onOpenQuota}
              {...(props.quotaDetail ? { detail: props.quotaDetail } : {})}
            />
            {!compact && (
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
            )}
          </>
        )}
      </div>
      <div className="status-bar-group">
        {compact ? (
          <>
            {keepAwake}
            <Popover open={open} onOpenChange={setOpen}>
              <IconTip label={t("statusBar.more")}>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={t("statusBar.more")} className="status-item">
                    <Ellipsis aria-hidden="true" />
                  </button>
                </PopoverTrigger>
              </IconTip>
              <PopoverContent
                side="top"
                align="end"
                className="flex w-auto max-w-[calc(100vw-1rem)] flex-col gap-0.5 p-1"
              >
                {props.quota && (
                  <MoreRow
                    name={refreshName}
                    disabled={props.refreshing}
                    onClick={closing(props.onRefreshQuota)}
                  >
                    <RefreshCw aria-hidden="true" />
                  </MoreRow>
                )}
                {update && (
                  <MoreRow name={updateName} onClick={closing(props.onOpenUpdate)}>
                    <UpdateIcon aria-hidden="true" data-mark="" />
                  </MoreRow>
                )}
                <MoreRow name={terminalsName} onClick={closing(props.onOpenTerminals)}>
                  <SquareTerminal aria-hidden="true" />
                </MoreRow>
                <MoreRow name={hostsName} onClick={closing(props.onOpenHosts)}>
                  <Server aria-hidden="true" />
                </MoreRow>
              </PopoverContent>
            </Popover>
          </>
        ) : (
          <>
            {update && (
              <Item name={updateName} onClick={props.onOpenUpdate}>
                <UpdateIcon aria-hidden="true" data-mark="" />
                <span className="status-short">
                  {t(`statusBar.updateShort.${update}` as Key, { version })}
                </span>
              </Item>
            )}
            {keepAwake}
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
          </>
        )}
      </div>
    </section>
  );
}

/** The quota's windows and guard, shown in the popover that the quota item opens. */
const quotaDetailFor = (store: AppStore) => (close: () => void) => (
  <QuotaDetail store={store} onClose={close} />
);

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
    /** With the store, pressing the quota opens its windows and the guard (issue #1218). */
    store?: AppStore;
    onRefreshQuota(): void;
    onOpenTerminals(): void;
    go(route: Route): void;
  }>,
) {
  const { state, go, store } = props;
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
      {...(store && glance
        ? {
            quotaDetail: quotaDetailFor(store),
          }
        : {})}
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
