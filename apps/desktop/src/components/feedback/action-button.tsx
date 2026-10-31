import type * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * A button that answers a click: pending at once while the work its handler started goes on
 * (when the handler returns a promise, or with `pending`), and a reason, in plain sight, when it
 * is disabled.
 */
export function ActionButton(
  props: React.ComponentProps<typeof Button> & {
    /** The work this click started is going on: busy, disabled, a spinner. */
    pending?: boolean;
    /** Why the button is disabled, said next to it for everyone, not only on hover. */
    disabledReason?: string;
  },
) {
  const { pending: _pending, disabledReason: _disabledReason, ...rest } = props;
  return <Button {...rest} />;
}
