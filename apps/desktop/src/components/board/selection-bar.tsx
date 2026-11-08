import type { BoardColumn } from "@flightdeck/protocol";
import type * as React from "react";
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
export function SelectionBar(
  props: Readonly<{
    t: T;
    /** The selected cards that are shown, and those a filter hides. */
    shown: number;
    hidden: number;
    onMove(column: BoardColumn): void;
    onDiscard(): void;
    onClear(): void;
    /** A batch is running: nothing else can start. */
    busy: boolean;
    onEscape(): void;
  }>,
) {
  const { t } = props;
  const leaveOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) props.onEscape();
  };
  return (
    <fieldset // NOSONAR: Escape leaves the selection from any control in the bar; the bar is a group, not a control
      aria-label={t("board.selection")}
      onKeyDown={leaveOnEscape}
      className="m-0 flex min-h-8 min-w-0 flex-wrap items-center gap-2 rounded-md bg-muted pl-3 text-sm"
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
          <Button size="sm" variant="outline" disabled={props.shown === 0 || props.busy}>
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
      <Button
        size="sm"
        variant="outline"
        disabled={props.shown === 0 || props.busy}
        onClick={props.onDiscard}
      >
        {t("board.discardSelected")}
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onClear}>
        {t("board.clearSelection")}
      </Button>
    </fieldset>
  );
}

/**
 * The toolbar's row, which the bar covers while cards are selected (#760): both sit in one grid
 * cell, so the first click moves no card and the body keeps no blank band for the bar. Under the
 * bar the toolbar is invisible and inert, out of the focus order and the accessibility tree.
 */
export function SelectionSlot(
  props: Readonly<{ bar: React.ReactNode; children: React.ReactNode }>,
) {
  const covered = Boolean(props.bar);
  return (
    <div data-slot="selection-slot" className="selection-stack">
      <div className={covered ? "invisible" : undefined} inert={covered}>
        {props.children}
      </div>
      {props.bar}
    </div>
  );
}
