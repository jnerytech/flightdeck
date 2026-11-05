import type { BoardColumn } from "@flightdeck/protocol";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Key, T } from "../../i18n/index.ts";
import { COLUMNS } from "../../lib/board.ts";

/** Above the board while cards are selected: how many, and what to do with them. */
export function SelectionBar(props: {
  t: T;
  /** The selected cards that are shown, and those a filter hides. */
  shown: number;
  hidden: number;
  onMove(column: BoardColumn): void;
  onDiscard(): void;
  onClear(): void;
}) {
  const { t } = props;
  return (
    <div
      role="toolbar"
      aria-label={t("board.selection")}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
    >
      <span>
        {props.shown === 1 ? t("board.selectedOne") : t("board.selectedCount", { n: props.shown })}
      </span>
      {props.hidden > 0 && (
        <span className="text-muted-foreground text-xs">
          {props.hidden === 1 ? t("board.hiddenOne") : t("board.hiddenCount", { n: props.hidden })}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={props.shown === 0}>
            {t("board.moveSelected")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {COLUMNS.map(({ id }) => (
            <DropdownMenuItem key={id} onSelect={() => props.onMove(id)}>
              {t(`kanban.columns.${id}` as Key)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="outline" disabled={props.shown === 0} onClick={props.onDiscard}>
        {t("board.discardSelected")}
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onClear}>
        {t("board.clearSelection")}
      </Button>
    </div>
  );
}
