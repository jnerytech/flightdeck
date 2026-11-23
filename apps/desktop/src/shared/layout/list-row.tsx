import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One row of a list: the title wins the width and truncates last; the meta gives way first (its
 * shrink factor is far higher) and renders nothing when empty; the ends never shrink.
 */
export function ListRow(
  props: Readonly<{
    leading?: ReactNode;
    title: ReactNode;
    meta?: ReactNode;
    trailing?: ReactNode;
    /** A bordered row with padding, for a list of items one picks from. */
    boxed?: boolean;
    /** The row of the item that is open. */
    selected?: boolean;
    /** Wraps instead of truncating: a long title is read whole and the ends drop to the next line. */
    wrap?: boolean;
    className?: string;
  }>,
) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        props.wrap && "flex-wrap",
        props.boxed && "rounded-md border px-3 py-2 text-sm",
        props.selected && "bg-accent",
        props.className,
      )}
    >
      {props.leading && (
        <span data-row-leading className="shrink-0">
          {props.leading}
        </span>
      )}
      <span
        data-row-title
        className={cn(
          "min-w-0",
          // A wrapping title starts from a small basis: the mark stays beside it and the ends drop first.
          props.wrap ? "basis-32 grow break-words" : "flex-auto truncate",
        )}
      >
        {props.title}
      </span>
      {props.meta && (
        <span
          data-row-meta
          className={cn(
            "min-w-0 shrink-[8] text-muted-foreground text-xs",
            props.wrap ? "break-words" : "truncate",
          )}
        >
          {props.meta}
        </span>
      )}
      {props.trailing && (
        <span
          data-row-trailing
          // On a line of its own the group keeps its content width; capped at the row's, its controls wrap.
          className={cn("shrink-0", props.wrap && "max-w-full")}
        >
          {props.trailing}
        </span>
      )}
    </div>
  );
}
