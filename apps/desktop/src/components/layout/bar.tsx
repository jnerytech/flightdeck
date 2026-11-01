/** A horizontal bar as wide as `ratio` (0 to 1) of its row, for a time or a share. */
export function Bar(props: { ratio: number }) {
  return (
    <div
      data-bar
      aria-hidden="true"
      className="h-1.5 rounded bg-primary"
      style={{ width: `${Math.min(1, Math.max(0, props.ratio)) * 100}%` }}
    />
  );
}
