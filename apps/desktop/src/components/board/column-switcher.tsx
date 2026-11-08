import type { BoardColumn } from "@flightdeck/protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * A narrow board's columns (#1198): one button per column, with its count, shows that column
 * alone instead of a sideways scroll that cut the board to two of its five columns.
 */
export function ColumnSwitcher(
  props: Readonly<{
    label: string;
    columns: ReadonlyArray<{ id: BoardColumn; title: string; count: number; name: string }>;
    shown: BoardColumn;
    onShow(column: BoardColumn): void;
  }>,
) {
  return (
    <fieldset
      aria-label={props.label}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      {props.columns.map((column) => (
        <Button
          key={column.id}
          type="button"
          size="sm"
          variant="outline"
          aria-label={column.name}
          aria-pressed={column.id === props.shown}
          className="aria-pressed:bg-accent"
          onClick={() => props.onShow(column.id)}
        >
          {column.title}
          <Badge variant="secondary">{column.count}</Badge>
        </Button>
      ))}
    </fieldset>
  );
}
