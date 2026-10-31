import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * A button that answers a click: busy at once while the work its handler started goes on (the
 * handler returns a promise, or `pending`), and a reason in plain sight when it is disabled.
 */
export function ActionButton(
  props: React.ComponentProps<typeof Button> & {
    /** The work this click started is going on: busy, disabled, a spinner. */
    pending?: boolean;
    /** Why the button is disabled, said next to it for everyone, not only on hover. */
    disabledReason?: string;
  },
) {
  const { pending = false, disabledReason, onClick, disabled, children, ...rest } = props;
  const reasonId = React.useId();
  const [running, setRunning] = React.useState(false);
  const busy = pending || running;
  const showReason = Boolean(disabled && !busy && disabledReason);
  const handle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const result = onClick?.(event) as unknown;
    if (typeof (result as PromiseLike<unknown> | undefined)?.then !== "function") return;
    setRunning(true);
    const done = () => setRunning(false);
    (result as PromiseLike<unknown>).then(done, done);
  };
  return (
    <>
      <Button
        {...rest}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-describedby={showReason ? reasonId : rest["aria-describedby"]}
        onClick={handle}
      >
        {busy && <LoaderCircle data-slot="spinner" className="animate-spin" aria-hidden="true" />}
        {children}
      </Button>
      {showReason && (
        <span id={reasonId} className="text-muted-foreground text-xs">
          {disabledReason}
        </span>
      )}
    </>
  );
}
