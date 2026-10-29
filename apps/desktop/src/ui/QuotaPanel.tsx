import type { QuotaHistory } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppState, AppStore, HostView } from "../lib/app-store.ts";
import { HISTORY_HOURS, projectionText, quotaBars, SHOWN } from "../lib/quota.ts";
import { hasFeature } from "../lib/version.ts";

/** One host's bars; with costs (phase 8) each one has the projection in its tooltip. */
function HostQuota(props: { store: AppStore; state: AppState; host: HostView }) {
  const { store, state, host } = props;
  const quota = state.quota[host.id];
  const bars = quotaBars(quota, store.now(), (iso) => store.formatTime(iso));
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
        texts[history.window] = projectionText(history.window, history.projection, (iso) =>
          store.formatTime(iso),
        );
      }
      setProjections(texts);
    });
  }, [store, host.id, costs, readings]);
  return (
    <section aria-label={`Cota de ${host.name}`} className="quota">
      {bars.map((bar) => (
        <div
          key={bar.window}
          data-window={bar.window}
          className={bar.hot ? "quota-bar quota-hot" : "quota-bar"}
          {...(projections[bar.window] ? { title: projections[bar.window] } : {})}
        >
          <span>{bar.text}</span>
          <meter aria-label={`${bar.label} de ${host.name}`} min={0} max={1} value={bar.value} />
        </div>
      ))}
      {bars.some((bar) => bar.hot) && (
        <p className="notice">
          {`${host.name}: cota acima de ${pauseAt}%: cards novos esperam a cota; sessões manuais seguem.`}
        </p>
      )}
    </section>
  );
}

/** The plan quota of each online host: 5 hours and 7 days, red from the host's `pauseAt`. */
export function QuotaPanel(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  return (
    <div className="quota-panel">
      {state.hosts
        // Only hosts that announce the quota (phase 7 or later).
        .filter(
          (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "quota", false),
        )
        .map((host) => (
          <HostQuota key={host.id} store={store} state={state} host={host} />
        ))}
    </div>
  );
}
