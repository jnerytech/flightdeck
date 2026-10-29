import { cn } from "@/lib/utils";
import type { StateTone } from "./state-badge";

// Whole class names, so Tailwind finds them. Only a running session pulses (when motion is
// allowed); an ended one fades.
const TONE: Record<StateTone, string> = {
  running: "bg-status-running motion-safe:animate-pulse",
  "needs-you": "bg-status-needs-you",
  idle: "bg-status-idle",
  ended: "bg-status-ended opacity-50",
  error: "bg-status-error",
};

/** The state of a session as an 8 px dot; the label is its name for screen readers and a tooltip. */
export function StatusDot(props: { tone: StateTone; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={props.label}
      title={props.label}
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE[props.tone], props.className)}
    />
  );
}
