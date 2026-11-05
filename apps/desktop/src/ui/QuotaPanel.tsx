import type { QuotaHistory } from "@flightdeck/protocol";
import { memo, useEffect, useState } from "react";
import { Grid } from "@/components/layout/stack";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import type { AppState, AppStore, HostView } from "../lib/app-store.ts";
import { HISTORY_HOURS, projectionText, quotaBars, quotaGroups, SHOWN } from "../lib/quota.ts";
import { hasFeature } from "../lib/version.ts";

// The native meter, drawn with the state tokens (WebKit/Blink and Gecko pseudo-elements).
const METER =
  "h-2 w-full [&::-webkit-meter-bar]:h-2 [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted";
const METER_OK =
  "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-running [&::-moz-meter-bar]:bg-status-running";
const METER_HOT =
  "[&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-error [&::-moz-meter-bar]:bg-status-error";

/** One host's card: its name and the two windows with a bar; with costs (phase 8) each window has the projection in its tooltip. */
function HostQuota(props: {
  store: AppStore;
  quota: AppState["quota"];
  /** The hosts that share the account: the card shows the reading of the first one that has it. */
  hosts: HostView[];
}) {
  const { store } = props;
  const { t } = store.i18n;
  const host = props.hosts.find((h) => props.quota[h.id]) ?? (props.hosts[0] as HostView);
  const names = props.hosts.map((h) => h.name).join(" · ");
  const quota = props.quota[host.id];
  const bars = quotaBars(quota, store.now(), (iso) => store.formatTime(iso), t);
  const pauseAt = Math.round((quota?.pauseAt ?? 0) * 100);
  const costs = hasFeature(host.hostInfo?.features, "costs", false);
  const [projections, setProjections] = useState<Record<string, string>>({});
  // A new reading may move the projection.
  const readings = JSON.stringify(quota?.windows ?? []);
  useEffect(() => {
    if (!costs || readings === "") return;
    void Promise.all(
      SHOWN.map((window) =>
        store.hostCommand(host.id, "quota.history", {
          window,
          hours: HISTORY_HOURS[window] as number,
        }),
      ),
    ).then((all) => {
      const texts: Record<string, string> = {};
      for (const history of all.filter((h): h is QuotaHistory => h !== null)) {
        texts[history.window] = projectionText(
          history.window,
          history.projection,
          (iso) => store.formatTime(iso),
          t,
        );
      }
      setProjections(texts);
    });
  }, [store, host.id, costs, readings, t]);
  const anyReading = bars.some((bar) => bar.hasReading);
  return (
    <section
      aria-label={t("quota.region", { host: names })}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground"
    >
      <h3 className="font-semibold">{names}</h3>
      {!anyReading && <p className="text-muted-foreground text-sm">{t("quota.noReading")}</p>}
      {anyReading &&
        bars.map((bar) => (
          <div
            key={bar.window}
            data-window={bar.window}
            data-hot={bar.hot}
            className="flex flex-col gap-1"
            {...(projections[bar.window] ? { title: projections[bar.window] } : {})}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm">{bar.label}</span>
              {bar.hasReading && (
                <span className={cn("font-medium text-sm", bar.hot && "text-status-error")}>
                  {`${bar.percent}%`}
                </span>
              )}
            </div>
            {bar.hasReading ? (
              <>
                <meter
                  aria-label={t("quota.meter", { window: bar.label, host: names })}
                  min={0}
                  max={1}
                  value={bar.value}
                  className={cn(METER, bar.hot ? METER_HOT : METER_OK)}
                />
                <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
                  {bar.reset && <span>{bar.reset}</span>}
                  <span>{bar.age}</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">{t("quota.noReading")}</p>
            )}
          </div>
        ))}
      {bars.some((bar) => bar.hot) && (
        <p className="text-sm text-status-needs-you">
          {t("quota.hotNotice", { host: names, pct: pauseAt })}
        </p>
      )}
    </section>
  );
}

const QUOTAPANEL_KEYS = ["quota", "hosts", "account"] as const;

/** The plan quota of each online host, as cards in a grid: 5 hours and 7 days, red from `pauseAt`. */
export const QuotaPanel = memo(function QuotaPanel(props: { store: AppStore }) {
  const { store } = props;
  const state = useStoreSlice(store, QUOTAPANEL_KEYS);
  const hosts = state.hosts.filter(
    // Only hosts that announce the quota (phase 7 or later).
    (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "quota", false),
  );
  // Which account each host is signed in to: hosts that share one share its quota, so one card.
  const watching = hosts
    .filter((host) => hasFeature(host.hostInfo?.features, "account", false))
    .map((host) => host.id)
    .join("\n");
  useEffect(() => {
    const stops = watching === "" ? [] : watching.split("\n").map((id) => store.watchAccount(id));
    return () => {
      for (const stop of stops) stop();
    };
  }, [store, watching]);
  if (hosts.length === 0) return null;
  return (
    <Grid cols={{ base: 1, md: 2, xl: 3 }} gap={4}>
      {quotaGroups(hosts, state.account).map((group) => (
        <HostQuota key={group.key} store={store} quota={state.quota} hosts={group.hosts} />
      ))}
    </Grid>
  );
});
