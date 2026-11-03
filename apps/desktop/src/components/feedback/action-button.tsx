import * as React from "react";
import { Spinner } from "@/components/feedback/busy";
import { useFieldRow } from "@/components/layout/form";
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
  // A ref too: two clicks in the same event see the first one before React renders it.
  const started = React.useRef(false);
  const busy = pending || running;
  const showReason = Boolean(disabled && !busy && disabledReason);
  const row = useFieldRow();
  const inRow = row !== null;
  // In a form row the reason is the row's help line, under the first field.
  React.useEffect(() => {
    if (!row || !showReason) return;
    row.setReason(disabledReason ?? null);
    return () => row.setReason(null);
  }, [row, showReason, disabledReason]);
  const handle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (started.current) return;
    const result = onClick?.(event) as unknown;
    if (typeof (result as PromiseLike<unknown> | undefined)?.then !== "function") return;
    started.current = true;
    setRunning(true);
    const done = () => {
      started.current = false;
      setRunning(false);
    };
    (result as PromiseLike<unknown>).then(done, done);
  };
  const button = (
    <Button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-describedby={showReason ? (row?.id ?? reasonId) : rest["aria-describedby"]}
      onClick={handle}
    >
      {busy && <Spinner />}
      {children}
    </Button>
  );
  if (!showReason || inRow) return button;
  // The reason hangs under the button and takes no height, so a row of an input and this button
  // keeps the button as tall as the input and lined up with it.
  return (
    <span className="action-button-box">
      {button}
      <span id={reasonId} className="action-reason">
        {disabledReason}
      </span>
    </span>
  );
}
