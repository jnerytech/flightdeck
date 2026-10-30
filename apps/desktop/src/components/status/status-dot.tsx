import { cn } from "@/lib/utils";

/** The five tones a status takes, shared by the dot, the text and the lists. */
export type StateTone = "running" | "needs-you" | "idle" | "ended" | "error";

// Whole class names, so Tailwind finds them. An ended session fades; a hollow dot is a ring.
const TONE: Record<StateTone, string> = {
  running: "bg-status-running",
  "needs-you": "bg-status-needs-you",
  idle: "bg-status-idle",
  ended: "bg-status-ended opacity-50",
  error: "bg-status-error",
};
const HOLLOW: Record<StateTone, string> = {
  running: "border border-status-running bg-transparent",
  "needs-you": "border border-status-needs-you bg-transparent",
  idle: "border border-status-idle bg-transparent",
  ended: "border border-status-ended bg-transparent opacity-50",
  error: "border border-status-error bg-transparent",
};

/**
 * The state of a session as an 8 px dot; the label is its name for screen readers and a tooltip.
 * Only a running one pulses by default (when motion is allowed); `hollow` draws a ring.
 */
export function StatusDot(props: {
  tone: StateTone;
  label: string;
  hollow?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const pulse = props.pulse ?? props.tone === "running";
  return (
    <span
      role="img"
      aria-label={props.label}
      title={props.label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        props.hollow ? HOLLOW[props.tone] : TONE[props.tone],
        pulse && "motion-safe:animate-pulse",
        props.className,
      )}
    />
  );
}
