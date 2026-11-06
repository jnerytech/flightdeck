import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One indexed session as a card: title, project, host, date, cost, origin, possibly in use. */
export function HistoryCard(
  props: Readonly<{
    title: string;
    project: string;
    host: string;
    /** The last activity, already formatted. */
    when: string;
    origin: string;
    cost?: string;
    costLabel: string;
    /** Said when the file changed in the last minutes: another process may still write it. */
    maybeActive?: string;
    /** Said for a run nobody typed. */
    automated?: string;
    current?: boolean;
    onOpen(): void;
    extra?: ReactNode;
  }>,
) {
  return (
    <li
      data-slot="history-card"
      aria-label={props.title}
      aria-current={props.current ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 text-sm transition-colors duration-150 hover:bg-accent aria-[current=true]:bg-accent",
      )}
    >
      <button
        type="button"
        onClick={props.onOpen}
        className="min-w-0 truncate text-left font-medium"
      >
        {props.title}
      </button>
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
        <span className="min-w-0 truncate">{props.project}</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{props.host}</span>
        {props.cost !== undefined && (
          <output aria-label={props.costLabel} className="ml-auto shrink-0 tabular-nums">
            {props.cost}
          </output>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <time className="tabular-nums">{props.when}</time>
        <span className="rounded bg-muted px-1 text-foreground">{props.origin}</span>
        {props.automated && <span className="rounded bg-muted px-1">{props.automated}</span>}
        {props.maybeActive && <span className="text-status-needs-you">{props.maybeActive}</span>}
        {props.extra}
      </div>
    </li>
  );
}
