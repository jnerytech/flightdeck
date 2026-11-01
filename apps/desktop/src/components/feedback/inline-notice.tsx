import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Whole class names, so Tailwind finds them.
const TONE = {
  warn: "border-status-needs-you/40 text-status-needs-you",
  info: "text-muted-foreground",
  error: "border-status-error/40 text-status-error",
} as const;

/**
 * A sentence that belongs to the screen (not a toast): a warning, a note or an error. An error is
 * an alert (announced at once); the others are a polite status. Do not nest it in another live
 * region, or a screen reader says it twice.
 */
export function InlineNotice(props: {
  tone?: keyof typeof TONE;
  /** So a control can point at the note with aria-describedby. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={props.id}
      role={props.tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", TONE[props.tone ?? "warn"])}
    >
      {props.children}
    </p>
  );
}
