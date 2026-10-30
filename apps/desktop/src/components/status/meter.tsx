import { cn } from "@/lib/utils";

// The native meter, drawn with the state tokens (WebKit/Blink and Gecko pseudo-elements).
const METER =
  "h-2 w-40 [&::-webkit-meter-bar]:h-2 [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-status-running [&::-moz-meter-bar]:bg-status-running";

/** A bar of `value` against `max`, with its label for screen readers. */
export function Meter(props: { label: string; value: number; max: number; className?: string }) {
  return (
    <meter
      aria-label={props.label}
      min={0}
      max={props.max}
      value={props.value}
      className={cn(METER, props.className)}
    />
  );
}
