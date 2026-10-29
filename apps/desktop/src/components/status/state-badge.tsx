import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The states a session shows (their colors are the theme's state tokens). */
export type StateTone = "running" | "needs-you" | "idle" | "ended" | "error";

// Whole class names, so Tailwind finds them.
const TONE: Record<StateTone, string> = {
  running: "text-status-running border-status-running/40",
  "needs-you": "text-status-needs-you border-status-needs-you/40",
  idle: "text-status-idle border-status-idle/40",
  ended: "text-status-ended border-status-ended/40",
  error: "text-status-error border-status-error/40",
};

/** A session's state as a colored badge. */
export function StateBadge(props: { tone: StateTone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TONE[props.tone])}>
      {props.children}
    </Badge>
  );
}
