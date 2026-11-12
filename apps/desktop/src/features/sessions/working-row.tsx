import { useEffect, useState } from "react";
import { Inline } from "@/components/layout/stack";

/** "12s", "1m 5s": how long the turn has been running. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

/**
 * The last row of a conversation while Claude works: moving dots, how long the turn has run and
 * the tool it is in. `nowMs` fixes the clock (tests); without it the row ticks each second.
 */
export function WorkingRow(
  props: Readonly<{
    label: string;
    since: number;
    tool: string | null;
    nowMs?: number;
  }>,
) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (props.nowMs !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [props.nowMs]);
  const now = props.nowMs ?? tick;
  return (
    <output aria-live="polite" aria-label={props.label} className="text-muted-foreground text-sm">
      <Inline gap={2}>
        <span aria-hidden="true" className="dots-working">
          <i />
          <i />
          <i />
        </span>
        <span>
          {props.label} {elapsed(now - props.since)}
          {props.tool ? ` · ${props.tool}` : ""}
        </span>
      </Inline>
    </output>
  );
}
