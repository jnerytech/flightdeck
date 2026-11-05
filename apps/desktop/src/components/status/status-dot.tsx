import { CircleAlert, MessageCircleQuestion } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The five tones a status takes, shared by the dot, the text and the lists. */
export type StateTone = "running" | "needs-you" | "idle" | "ended" | "error";

/**
 * Whether the element is on screen. A list of 200 sessions keeps only the spinners in view
 * turning; without IntersectionObserver (tests, old webviews) everything counts as visible.
 */
function useOnScreen<T extends Element>(active: boolean) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setVisible(last.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);
  return { ref, visible };
}

/** What each tone draws, in a 12 px slot: the colour is the token's, the shape is the signal. */
function glyph(tone: StateTone, turning: boolean): ReactNode {
  switch (tone) {
    case "running":
      // A ring with its top open. Reduced motion leaves it still: three quarters, never a full ring.
      return (
        <span
          data-glyph="spinner"
          className={cn(
            "size-2.5 rounded-full border-2 border-status-running border-t-transparent",
            turning && "motion-safe:animate-spin",
          )}
        />
      );
    case "needs-you":
      return <MessageCircleQuestion aria-hidden="true" className="size-3 text-status-needs-you" />;
    case "error":
      return <CircleAlert aria-hidden="true" className="size-3 text-status-error" />;
    case "ended":
      return (
        <span
          data-glyph="ring"
          className="size-2 rounded-full border border-status-ended bg-transparent opacity-50"
        />
      );
    case "idle":
      return <span data-glyph="dot" className="size-1.5 rounded-full bg-status-idle" />;
  }
}

// Whole class names, so Tailwind finds them. Ended fades; hollow is a ring.
const DOT: Record<StateTone, string> = {
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
 * The state of a session as a glyph in a 12 px slot: a spinner while it runs, a question mark when
 * it needs you, an alert on error, a dot when idle and a faded ring when ended. The label is its
 * name for screen readers and the tooltip; other attributes go to the slot.
 */
export function StatusDot({
  tone,
  label,
  className,
  dot,
  hollow,
  pulse,
  ...rest
}: {
  tone: StateTone;
  label: string;
  /** A plain 8 px dot instead of a glyph: for what is not a session's state (a host's connection). */
  dot?: boolean;
  /** With `dot`: a ring. */
  hollow?: boolean;
  /** With `dot`: breathes when motion is allowed. */
  pulse?: boolean;
} & Omit<ComponentProps<"span">, "children">) {
  const { ref, visible } = useOnScreen<HTMLSpanElement>(!dot && tone === "running");
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            {...rest}
            ref={ref}
            role="img"
            aria-label={label}
            className={cn(
              dot
                ? cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    hollow ? HOLLOW[tone] : DOT[tone],
                    pulse && "motion-safe:animate-pulse",
                  )
                : "inline-flex size-3 shrink-0 items-center justify-center",
              className,
            )}
          >
            {dot ? null : glyph(tone, visible)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
