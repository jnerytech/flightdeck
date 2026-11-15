import { useEffect, useState } from "react";
import { Inline } from "@/shared/layout/index.ts";
import { elapsed } from "./domain/session-text.ts";

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
        {/* A screen reader hears the word and the tool; the seconds tick for the eyes only (#2674). */}
        <span>
          {props.label}
          {props.tool ? ` · ${props.tool}` : ""}
        </span>
        <span aria-hidden="true">{elapsed(now - props.since)}</span>
      </Inline>
    </output>
  );
}
