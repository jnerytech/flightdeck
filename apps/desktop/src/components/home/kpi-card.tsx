import type { ReactNode } from "react";
import { Sparkline } from "./sparkline.tsx";

/**
 * One card of Home: the title, the number first, what goes with it, and its seven days. The whole
 * card is the button that opens the screen it summarizes.
 */
export function KpiCard(props: {
  title: string;
  /** The accessible name of the button ("Open Spend"). */
  openLabel: string;
  value: string;
  details: ReactNode;
  series: number[];
  seriesLabel: string;
  onOpen(): void;
}) {
  return (
    <button type="button" aria-label={props.openLabel} className="kpi-card" onClick={props.onOpen}>
      <span className="kpi-title">{props.title}</span>
      <span className="kpi-value">{props.value}</span>
      <span className="kpi-details">{props.details}</span>
      <Sparkline values={props.series} label={props.seriesLabel} />
    </button>
  );
}
