import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IN_FLIGHT, useAfter } from "@/hooks/use-in-flight";
import { cn } from "@/lib/utils";

/** An empty list or panel: a large soft icon, one sentence and one action. */
export function EmptyState(props: { title: string; icon?: LucideIcon; action?: ReactNode }) {
  const Icon = props.icon;
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/30 p-8 text-center">
      {Icon && <Icon aria-hidden="true" className="size-10 text-muted-foreground/40" />}
      <p className="text-muted-foreground">{props.title}</p>
      {props.action}
    </div>
  );
}

/** The shape of the placeholder: text rows, board columns or a strip of summary tiles. */
export type LoadingShape = "rows" | "columns" | "tiles";

/** A list or panel still loading. */
export function LoadingState(props: { label: string; shape?: LoadingShape }) {
  const shape = props.shape ?? "rows";
  // Announced at once; the placeholders wait 200 ms so a quick load flashes nothing.
  const drawn = useAfter(IN_FLIGHT.deferMs);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={props.label}
      data-shape={shape}
      className={cn("gap-2", shape === "rows" ? "flex flex-col" : "grid gap-3", GRID[shape])}
    >
      {drawn && shape === "rows" && ROWS.map((w) => <Skeleton key={w} className={cn("h-5", w)} />)}
      {drawn &&
        shape === "columns" &&
        [0, 1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-40 rounded-lg" />)}
      {drawn &&
        shape === "tiles" &&
        [0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-20 rounded-lg" />)}
    </div>
  );
}

const ROWS = ["w-2/3", "w-1/2", "w-3/4"];
const GRID: Record<LoadingShape, string> = {
  rows: "",
  columns: "grid-cols-5",
  tiles: "grid-cols-4",
};

/** A list or panel that failed: the message and a way to try again. */
export function ErrorState(props: { message: string; retryLabel: string; onRetry(): void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4 text-destructive"
    >
      <p>{props.message}</p>
      <Button variant="outline" onClick={props.onRetry}>
        {props.retryLabel}
      </Button>
    </div>
  );
}
