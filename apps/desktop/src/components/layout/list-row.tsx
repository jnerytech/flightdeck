import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One row of a list: the title wins the width and truncates last; the meta gives way first (its
 * shrink factor is far higher) and renders nothing when empty; the ends never shrink.
 */
export function ListRow(props: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** A bordered row with padding, for a list of items one picks from. */
  boxed?: boolean;
  /** The row of the item that is open. */
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
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
      <span data-row-title className="min-w-0 flex-auto truncate">
        {props.title}
      </span>
      {props.meta && (
        <span data-row-meta className="min-w-0 shrink-[8] truncate text-muted-foreground text-xs">
          {props.meta}
        </span>
      )}
      {props.trailing && (
        <span data-row-trailing className="shrink-0">
          {props.trailing}
        </span>
      )}
    </div>
  );
}
