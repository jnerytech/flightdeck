import type { BoardColumn } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import type * as React from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { FieldRow } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
    /** #1354: Move to…'s menu, also opened by `m` on a card of the selection. */
    moveOpen?: boolean;
    onMoveOpenChange?(open: boolean): void;
    /** Where the focus goes when that menu closes; false leaves it on the button. */
    onMoveClosed?(): boolean;
    /** #1354: how many selected cards Start and Stop can take, and what they do. */
    startCount: number;
    stopCount: number;
    onStart(): void;
    onStop(): void;
    /** #1406: how many selected cards Update from the base takes, and its run's progress. */
    updateCount: number;
    onUpdate(): void;
    updating: { done: number; total: number } | null;
    /** Selected cards in columns a narrow board does not show (the column switcher). */
    otherColumns: number;
    /** A narrow bar (390): Move to… and Discard… under ⋯, and a short Clear. */
    compact: boolean;
  }>,
) {
  const { t } = props;
  const leaveOnEscape = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    // It clears the selection: the Esc stops here, so a split view around the board stays open.
    e.stopPropagation();
    props.onEscape();
  };
  return (
    <fieldset // NOSONAR: Escape leaves the selection from any control in the bar; the bar is a group, not a control
      aria-label={t("board.selection")}
      onKeyDown={leaveOnEscape}
      className="m-0 min-h-8 min-w-0 rounded-md bg-muted pl-3 text-sm"
    >
      {/* #1354: a row whose disabled buttons say why on a line of the bar (#732), in the flow: a
          reason hung under a button was drawn over the cards at 1024 and past the window at 390. */}
      <FieldRow>
        <span>
          {props.shown === 1
            ? t("board.selectedOne")
            : t("board.selectedCount", { n: props.shown })}
        </span>
        {props.hidden > 0 && (
          <span className="text-muted-foreground text-xs">
            {props.hidden === 1
              ? t("board.hiddenOne")
              : t("board.hiddenCount", { n: props.hidden })}
          </span>
        )}
        {props.otherColumns > 0 && (
          <span className="text-muted-foreground text-xs">
            {props.otherColumns === 1
              ? t("board.otherColumnOne")
              : t("board.otherColumns", { n: props.otherColumns })}
          </span>
        )}
        {/* #1354: one primary, Start, while it has a card to take (#1197). */}
        <ActionButton
          size="sm"
          variant={props.startCount > 0 ? "default" : "outline"}
          disabled={props.startCount === 0 || props.busy}
          disabledReason={props.startCount === 0 ? t("board.noneCanStart") : undefined}
          onClick={props.onStart}
        >
          {t("board.startSelected", { n: props.startCount })}
        </ActionButton>
        {/* #1406: the run's progress, seen on the bar; the summary after it is what is announced. */}
        {props.updating && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("board.updating", props.updating)}
          </span>
        )}
        {/* Only while a selected card runs or waits in the queue: most selections have none. */}
        {props.stopCount > 0 && (
          <ActionButton size="sm" variant="outline" disabled={props.busy} onClick={props.onStop}>
            {t("board.stopSelected", { n: props.stopCount })}
          </ActionButton>
        )}
        {/* #1406: only while a selected card has a branch to update; under ⋯ on a narrow bar. */}
        {props.updateCount > 0 && !props.compact && (
          <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onUpdate}>
            {t("board.updateSelected", { n: props.updateCount })}
          </Button>
        )}
        <DropdownMenu
          {...(props.onMoveOpenChange
            ? { open: props.moveOpen ?? false, onOpenChange: props.onMoveOpenChange }
            : {})}
        >
          <DropdownMenuTrigger asChild>
            {props.compact ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={t("board.moreSelected")}
                disabled={props.shown === 0 || props.busy}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={props.shown === 0 || props.busy}>
                {t("board.moveSelected")}
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            onCloseAutoFocus={(e) => {
              if (props.onMoveClosed?.()) e.preventDefault();
            }}
          >
            {COLUMNS.map(({ id }) => (
              <DropdownMenuItem key={id} onSelect={() => props.onMove(id)}>
                {props.compact
                  ? t("board.moveTo", { column: t(`kanban.columns.${id}` as Key) })
                  : t(`kanban.columns.${id}` as Key)}
              </DropdownMenuItem>
            ))}
            {props.compact && <DropdownMenuSeparator />}
            {props.compact && props.updateCount > 0 && (
              <DropdownMenuItem onSelect={props.onUpdate}>
                {t("board.updateSelected", { n: props.updateCount })}
              </DropdownMenuItem>
            )}
            {props.compact && (
              <DropdownMenuItem onSelect={props.onDiscard}>
                {t("board.discardSelected")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {!props.compact && (
          <Button
            size="sm"
            variant="outline"
            disabled={props.shown === 0 || props.busy}
            onClick={props.onDiscard}
          >
            {t("board.discardSelected")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={props.onClear}>
          {props.compact ? t("board.clearShort") : t("board.clearSelection")}
        </Button>
      </FieldRow>
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
