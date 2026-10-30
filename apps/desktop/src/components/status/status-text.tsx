import type { StateTone } from "./state-badge";
import { StatusDot } from "./status-dot";

/** A state as its dot and its word, side by side (the word is the dot's name). */
export function StatusText(props: { tone: StateTone; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
      <StatusDot tone={props.tone} label={props.children} />
      {props.children}
    </span>
  );
}
