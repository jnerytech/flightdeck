/**
 * Phase 39: the name of a session's agent when it is not Claude Code ("OpenCode"), in the session's
 * header and in its row of the session list (`slot` tells the two apart).
 */
export function RuntimeBadge(props: { label: string; slot?: string }) {
  return (
    <span
      data-slot={props.slot ?? "runtime-badge"}
      className="shrink-0 rounded border px-1 text-foreground text-xs"
    >
      {props.label}
    </span>
  );
}
