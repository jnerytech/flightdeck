import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** An empty list or panel: one sentence and one action. */
export function EmptyState(props: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground">{props.title}</p>
      {props.action}
    </div>
  );
}

/** A list or panel still loading. */
export function LoadingState(props: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={props.label} className="flex flex-col gap-2">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  );
}

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
