/** A column's name and how many cards it has (`n / total` while a filter hides some). */
export function ColumnHeader(props: { title: string; count: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h3 className="font-medium text-muted-foreground text-xs">{props.title}</h3>
      <span
        data-slot="column-count"
        role="img"
        aria-label={props.label}
        className="rounded-full bg-muted px-1.5 text-muted-foreground text-xs tabular-nums"
      >
        <span aria-hidden="true">{props.count}</span>
      </span>
    </div>
  );
}
