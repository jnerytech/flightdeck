import type { QuotaHistory } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { ErrorState, LoadingState, Panel } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { HISTORY_HOURS, projectionText, SHOWN } from "../quota/index.ts";
import { usd } from "./domain/costs.ts";
import { PLOT, quotaPlot } from "./domain/quota-plot.ts";

/** The radius of a reading's dot; the plot's padding is wider, so no dot is cut by the svg edge. */
const DOT = 2;
const percent = (utilization: number) => `${Math.round(utilization * 100)}%`;

/** The plot of one window: its 0 and 100% marks, the line of the known readings and a dot for each. */
function Plot(props: Readonly<{ history: QuotaHistory; name: string }>) {
  const { segments, dots } = quotaPlot(props.history.samples);
  const bottom = PLOT.height - PLOT.bottom;
  const right = PLOT.width - PLOT.right;
  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      role="img"
      aria-label={props.name}
      className="w-full rounded-md border bg-card text-status-running"
    >
      <g className="text-border" stroke="currentColor">
        <line x1={PLOT.left} x2={right} y1={PLOT.top} y2={PLOT.top} />
        <line x1={PLOT.left} x2={right} y1={bottom} y2={bottom} />
      </g>
      <g className="fill-muted-foreground" fontSize={10} textAnchor="end">
        <text x={PLOT.left - 4} y={PLOT.top + 3}>
          {percent(1)}
        </text>
        <text x={PLOT.left - 4} y={bottom + 3}>
          {percent(0)}
        </text>
      </g>
      {segments.map((segment) => (
        <polyline
          key={`${segment[0]?.x},${segment[0]?.y}`}
          fill="none"
          stroke="currentColor"
          points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      ))}
      {dots.map((p) => (
        <circle
          key={`${p.takenAt}@${p.y}`}
          data-sample
          cx={p.x}
          cy={p.y}
          r={DOT}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/** The card of one window: its name above what it shows. It is as wide as the plot, and narrower in a narrow card. */
function WindowCard(props: Readonly<{ name: string; label: string; children: ReactNode }>) {
  return (
    <section aria-label={props.name} className="flex min-w-0 basis-60 flex-col gap-2">
      <h4 className="font-medium text-sm">{props.label}</h4>
      {props.children}
    </section>
  );
}

/** One window's utilization over time, its projection and, for 5 hours, who used it. */
function WindowChart(props: Readonly<{ store: AppStore; history: QuotaHistory }>) {
  const t = props.store.i18n.t;
  const { history } = props;
  const label = props.store.i18n.t(`quota.windows.${history.window}` as Key);
  const first = history.samples[0];
  const last = history.samples.at(-1);
  // The day shows too once a reading is not from today: a week's range is not 14:00 to 14:00.
  const time = (iso: string) => props.store.formatWhen(iso);
  const name =
    first && last
      ? t(
          last.utilization === null ? "quotaCharts.utilizationUnknown" : "quotaCharts.utilization",
          {
            label,
            value: String(Math.round(Math.min(1, Math.max(0, last.utilization ?? 0)) * 100)),
            from: time(first.takenAt),
            to: time(last.takenAt),
          },
        )
      : "";
  return (
    <WindowCard name={t("quotaCharts.window", { label })} label={label}>
      {first && last && <Plot history={history} name={name} />}
      {!(first && last) && (
        <p className="text-muted-foreground text-xs">{t("quotaCharts.empty")}</p>
      )}
      {first && last && (
        <p className="text-muted-foreground text-xs">
          {history.samples.length === 1
            ? t("quotaCharts.one", { time: time(first.takenAt) })
            : t("quotaCharts.range", { from: time(first.takenAt), to: time(last.takenAt) })}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        {projectionText(
          history.window,
          history.projection,
          (iso) => props.store.formatTime(iso),
          props.store.i18n.t,
        )}
      </p>
      {history.window === "five_hour" && (
        <section aria-label={t("quotaCharts.consumers")}>
          <p className="text-muted-foreground text-xs">{t("quotaCharts.attribution")}</p>
          <ul className="flex flex-col gap-1 text-xs tabular-nums">
            {history.consumers.map((c) => (
              <li
                key={c.projectKey}
                className="break-all"
              >{`${c.projectKey}: ${Math.round(c.share * 100)}% (${usd(c.costUsd, t.lang)})`}</li>
            ))}
          </ul>
        </section>
      )}
    </WindowCard>
  );
}

/** The 5-hour and 7-day windows of a host over time; a window whose read was refused says so and can be read again. */
export function QuotaCharts(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  // `null` is a refused read (the daemon answers a window with no readings with an empty history).
  const [slots, setSlots] = useState<Array<QuotaHistory | null> | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only asks for another read (Try again)
  useEffect(() => {
    // Another host, or another try, starts from loading: its charts never show the previous ones.
    setSlots(null);
    let current = true;
    void Promise.all(
      SHOWN.map((window) =>
        store.hostCommand(hostId, "quota.history", {
          window,
          hours: HISTORY_HOURS[window] as number,
        }),
      ),
    ).then((all) => {
      if (current) setSlots(all);
    });
    return () => {
      current = false;
    };
  }, [store, hostId, attempt]);
  const nothing = slots?.every((slot) => slot !== null && slot.samples.length === 0) === true;
  return (
    <section aria-label={t("quotaCharts.title")}>
      <Panel title={t("quotaCharts.title")}>
        {slots === null && <LoadingState label={t("quotaCharts.loading")} />}
        {nothing && <p className="text-muted-foreground text-sm">{t("quotaCharts.empty")}</p>}
        <div className="flex flex-wrap gap-6">
          {!nothing &&
            slots?.map((history, i) => {
              const window = SHOWN[i] as string;
              if (history) return <WindowChart key={window} store={store} history={history} />;
              const label = t(`quota.windows.${window}` as Key);
              return (
                <WindowCard key={window} name={t("quotaCharts.window", { label })} label={label}>
                  <ErrorState
                    message={t("quotaCharts.failed", { label })}
                    retryLabel={t("quotaCharts.retry")}
                    onRetry={() => setAttempt((n) => n + 1)}
                  />
                </WindowCard>
              );
            })}
        </div>
      </Panel>
    </section>
  );
}
