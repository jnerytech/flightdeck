import { cn } from "@/lib/utils";

// The native meter, drawn with the state tokens (WebKit/Blink and Gecko pseudo-elements).
const METER =
  "h-2 w-40 [&::-webkit-meter-bar]:h-2 [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-running [&::-moz-meter-bar]:bg-status-running";
const HOT = "[&::-webkit-meter-optimum-value]:bg-status-error [&::-moz-meter-bar]:bg-status-error";

/** A bar of `value` against `max`, with its label for screen readers; `hot` paints it as an alarm. */
export function Meter(
  props: Readonly<{
    label: string;
    value: number;
    max: number;
    /** What a screen reader says instead of the raw value ("62%"), when value over max is not a number a person reads. */
    valueText?: string;
    hot?: boolean;
    className?: string;
  }>,
) {
  return (
    <meter
      aria-label={props.label}
      min={0}
      max={props.max}
      value={props.value}
      aria-valuetext={props.valueText}
      data-hot={props.hot === true}
      className={cn(METER, props.hot && HOT, props.className)}
    />
  );
}
