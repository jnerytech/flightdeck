import type { AppState, AppStore } from "../lib/app-store.ts";
import { quotaBars } from "../lib/quota.ts";

/** The plan quota of each online host: 5 hours and 7 days, red from the host's `pauseAt`. */
export function QuotaPanel(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  const now = store.now();
  return (
    <div className="quota-panel">
      {state.hosts
        .filter((host) => host.status === "online")
        .map((host) => {
          const quota = state.quota[host.id];
          const bars = quotaBars(quota, now, (iso) => store.formatTime(iso));
          const pauseAt = Math.round((quota?.pauseAt ?? 0) * 100);
          return (
            <section key={host.id} aria-label={`Cota de ${host.name}`} className="quota">
              {bars.map((bar) => (
                <div
                  key={bar.window}
                  data-window={bar.window}
                  className={bar.hot ? "quota-bar quota-hot" : "quota-bar"}
                >
                  <span>{bar.text}</span>
                  <meter
                    aria-label={`${bar.label} de ${host.name}`}
                    min={0}
                    max={1}
                    value={bar.value}
                  />
                </div>
              ))}
              {bars.some((bar) => bar.hot) && (
                <p className="notice">
                  {`${host.name}: cota acima de ${pauseAt}%: cards novos esperam a cota; sessões manuais seguem.`}
                </p>
              )}
            </section>
          );
        })}
    </div>
  );
}
