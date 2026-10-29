import type { QuotaHistory } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { HISTORY_HOURS, projectionText, SHOWN, WINDOW_LABELS } from "../lib/quota.ts";

const WIDTH = 240;
const HEIGHT = 60;

/** One window's utilization over time, its projection and, for 5 hours, who used it. */
function WindowChart(props: { store: AppStore; history: QuotaHistory }) {
  const { history } = props;
  const label = WINDOW_LABELS[history.window] as string;
  const times = history.samples.map((s) => Date.parse(s.takenAt));
  const first = Math.min(...times);
  const span = Math.max(1, Math.max(...times) - first);
  const points = history.samples.map((s, i) => ({
    x: (((times[i] as number) - first) / span) * WIDTH,
    y: HEIGHT - (s.utilization ?? 0) * HEIGHT,
  }));
  return (
    <section aria-label={`Janela de ${label}`} className="quota-chart">
      <h4>{label}</h4>
      <svg width={WIDTH} height={HEIGHT} role="img" aria-label={`Utilização da janela de ${label}`}>
        <polyline
          fill="none"
          stroke="currentColor"
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        />
        {points.map((p, i) => (
          <circle key={history.samples[i]?.takenAt} data-sample cx={p.x} cy={p.y} r={2} />
        ))}
      </svg>
      <p>
        {projectionText(history.window, history.projection, (iso) => props.store.formatTime(iso))}
      </p>
      {history.window === "five_hour" && (
        <section aria-label="Quem consumiu a janela de 5 horas">
          <p className="muted">atribuição aproximada: o plano não diz quem consumiu</p>
          <ul>
            {history.consumers.map((c) => (
              <li
                key={c.projectKey}
              >{`${c.projectKey}: ${Math.round(c.share * 100)}% (${usd(c.costUsd)})`}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/** The 5-hour and 7-day windows of a host over time. */
export function QuotaCharts(props: { store: AppStore; hostId: string }) {
  const { store, hostId } = props;
  const [histories, setHistories] = useState<QuotaHistory[]>([]);
  useEffect(() => {
    void Promise.all(
      SHOWN.map((window) =>
        store.hostCommand(hostId, "quota.history", {
          window,
          hours: HISTORY_HOURS[window] as number,
        }),
      ),
    ).then((all) => setHistories(all.filter((h): h is QuotaHistory => h !== null)));
  }, [store, hostId]);
  return (
    <section aria-label="Cota" className="quota-charts">
      <h3>Cota</h3>
      {histories.map((history) => (
        <WindowChart key={history.window} store={store} history={history} />
      ))}
    </section>
  );
}
