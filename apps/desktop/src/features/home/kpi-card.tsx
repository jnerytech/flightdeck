import { type ReactNode, useId } from "react";
import { Sparkline } from "./sparkline.tsx";

/**
 * One card of Home: the title, the number first, what goes with it, and its seven days. The whole
 * card is the button that opens the screen it summarizes.
 */
export function KpiCard(
  props: Readonly<{
    title: string;
    /** The accessible name of the button ("Open Spend"). */
    openLabel: string;
    value: string;
    details: ReactNode;
    series: number[];
    seriesLabel: string;
    onOpen(): void;
  }>,
) {
  const id = useId();
  const valueId = `${id}-value`;
  const detailsId = `${id}-details`;
  const describedBy = `${valueId} ${detailsId}`;
  return (
    // The name says what the button opens; the number and the details are its description, so they are heard.
    <button
      type="button"
      aria-label={props.openLabel}
      aria-describedby={describedBy}
      className="kpi-card"
      onClick={props.onOpen}
    >
      <span className="kpi-title">{props.title}</span>
      <span id={valueId} className="kpi-value">
        {props.value}
      </span>
      {/* The details fill the card, so every card's sparkline sits on its bottom edge (#588). */}
      <span id={detailsId} className="kpi-details flex-1">
        {props.details}
      </span>
      <Sparkline values={props.series} label={props.seriesLabel} />
    </button>
  );
}
