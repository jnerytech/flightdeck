import { Moon } from "lucide-react";
import type { ReactNode } from "react";
import { type StateTone, StatusDot } from "@/components/status/status-dot";
import { cn } from "@/lib/utils";

/**
 * One session as a card: title (it opens the session), project, host, status, the last line, the
 * cost and the actions menu.
 */
export function SessionCard(props: {
  title: string;
  project: string;
  host: string;
  stateLabel: string;
  tone: StateTone;
  /** What the session asked and is doing: "Pedido: … · rodando Bash". */
  line: string;
  /** The formatted cost, when the host reports one. */
  cost?: string;
  costLabel: string;
  persona?: string | null;
  /** The word for a session with no process (asleep): shown with a moon. */
  asleep?: string | null;
  /** The session open on the right. */
  current?: boolean;
  /** The row the keyboard is on. */
  active?: boolean;
  onOpen(): void;
  actions?: ReactNode;
}) {
  return (
    <li
      data-slot="session-card"
      aria-label={props.title}
      aria-current={props.current ? "true" : undefined}
      data-active={props.active ?? false}
      className={cn(
        "group flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 text-sm transition-colors duration-150 hover:bg-accent data-[active=true]:bg-accent aria-[current=true]:bg-accent",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot tone={props.tone} label={props.stateLabel} />
        <button
          type="button"
          onClick={props.onOpen}
          className="min-w-0 flex-1 truncate text-left font-medium"
        >
          {props.title}
        </button>
        {props.actions}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
        <span className="min-w-0 truncate">{props.project}</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{props.host}</span>
        {props.persona && (
          <span className="shrink-0 rounded bg-muted px-1 text-foreground">{props.persona}</span>
        )}
        {props.asleep && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <Moon aria-hidden="true" className="size-3" />
            {props.asleep}
          </span>
        )}
        {props.cost !== undefined && (
          <output aria-label={props.costLabel} className="ml-auto shrink-0 tabular-nums">
            {props.cost}
          </output>
        )}
      </div>
      {props.line && (
        <p data-slot="card-line" className="line-clamp-2 text-muted-foreground text-xs">
          {props.line}
        </p>
      )}
    </li>
  );
}
