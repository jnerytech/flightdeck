import type { BoardColumn, Card, ContractOverrides } from "@flightdeck/protocol";
import type { ComponentProps } from "react";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { ColumnLane } from "./board-column.tsx";
import { CardTile } from "./card-tile.tsx";
import { COLUMNS, startOffText } from "./domain/board.ts";
import { dragNeeds } from "./domain/board-contracts.ts";
import {
  columnCount,
  countLabel,
  filteredColumnCount,
  filteredCountLabel,
} from "./domain/board-select.ts";
import { cardStartBlock } from "./domain/card-start-block.ts";
import type { useCardDrag } from "./use-card-drag.ts";

/**
 * The board's columns: each one a lane with its count, its empty and no-match lines and the width
 * handle, and in it a tile per shown card. The board keeps every piece of state; the lanes draw it
 * and report what a person did (open, add, start, select, drag, focus).
 */
export function BoardLanes(
  props: Readonly<{
    t: T;
    store: AppStore;
    contracts: ContractOverrides;
    hintId: string;
    /** The width of a column, and whether one column shows at a time (the narrow switcher). */
    width: number;
    switcher: boolean;
    showing: BoardColumn;
    /** Every card of the project, and the ones a filter leaves. */
    all: Card[];
    shown: Card[];
    filtering: boolean;
    drag: ReturnType<typeof useCardDrag>;
    /** The cards that take the Tab stop of their column. */
    tabStops: ReadonlySet<string>;
    selection: string[];
    busy: boolean;
    workflowOf(card: Card): string | undefined;
    quietOf(card: Card): ComponentProps<typeof CardTile>["quiet"];
    titlesOf(ids: string[]): string;
    movesOf(card: Card): ComponentProps<typeof CardTile>["moves"];
    keyOn(cardId: string): ComponentProps<typeof CardTile>["onKey"];
    onOpenCard(cardId: string, edit?: boolean): void;
    onAdd(column: BoardColumn): void;
    onDelete(card: Card): void;
    onStart(card: Card): void;
    onStartSelection(): void;
    onMoveSelection(card: Card): void;
    onToggleSelect(card: Card): void;
    onRangeSelect(card: Card): void;
    onFocusCard(cardId: string): void;
  }>,
) {
  const {
    t,
    store,
    contracts,
    hintId,
    width,
    switcher,
    showing,
    all,
    shown,
    filtering,
    drag,
    tabStops: stops,
    selection,
    busy,
    workflowOf,
    quietOf,
    titlesOf,
    movesOf,
    keyOn,
    onOpenCard,
    onAdd,
    onDelete,
    onStart,
    onStartSelection,
    onMoveSelection,
    onToggleSelect,
    onRangeSelect,
    onFocusCard,
  } = props;
  const counts = (inColumn: number, ofColumn: number) =>
    filtering
      ? {
          count: filteredColumnCount(inColumn, ofColumn),
          label: filteredCountLabel(t, inColumn, ofColumn),
        }
      : { count: columnCount(inColumn), label: countLabel(t, inColumn) };
  return (
    <>
      {COLUMNS.map(({ id }) => {
        /** What the dragged cards would lack here: said by the column until they let go. */
        const asking = dragNeeds(id, drag.dragCards, contracts);
        return (
          <ColumnLane
            key={id}
            t={t}
            id={id}
            hidden={switcher && id !== showing}
            asking={asking}
            over={drag.over === id}
            {...counts(
              shown.filter((card) => card.column === id).length,
              all.filter((card) => card.column === id).length,
            )}
            empty={all.every((card) => card.column !== id)}
            noMatches={
              filtering &&
              all.some((card) => card.column === id) &&
              shown.every((card) => card.column !== id)
            }
            onAdd={() => onAdd(id)}
            onDragEnter={() => drag.enter(id)}
            onDragLeave={drag.leave}
            onDrop={() => drag.drop(id)}
            handle={
              switcher
                ? undefined
                : {
                    width,
                    index: COLUMNS.findIndex((column) => column.id === id) + 1,
                    last: id === COLUMNS.at(-1)?.id,
                    onChange: (next) => store.boardWidth.set(next, false),
                    onCommit: () => store.boardWidth.persist(),
                  }
            }
          >
            {shown
              .filter((card) => card.column === id)
              .map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  contracts={contracts}
                  quiet={quietOf(card)}
                  workflow={workflowOf(card)}
                  formatTime={(iso) => store.formatTime(iso)}
                  labels={{
                    actions: store.i18n.t("board.cardActions", { title: card.title }),
                    start: store.i18n.t("board.startCard"),
                    edit: store.i18n.t("board.edit"),
                    delete: store.i18n.t("board.delete"),
                    select: t("board.selectCard"),
                    deselect: t("board.deselectCard"),
                    selectNamed: t("board.selectCardNamed", { title: card.title }),
                  }}
                  startOff={startOffText(cardStartBlock(card), store.i18n.t)}
                  deps={{
                    waiting: titlesOf(card.waitingOn),
                    holding: titlesOf(card.blocking),
                  }}
                  moves={movesOf(card)}
                  onOpen={() => onOpenCard(card.id)}
                  onEdit={() => onOpenCard(card.id, true)}
                  onDelete={() => onDelete(card)}
                  onStart={() => onStart(card)}
                  locked={busy}
                  selected={selection.includes(card.id)}
                  selecting={selection.length > 0}
                  onStartSelection={onStartSelection}
                  onMoveSelection={() => onMoveSelection(card)}
                  onToggleSelect={() => onToggleSelect(card)}
                  onRangeSelect={() => onRangeSelect(card)}
                  tabbable={stops.has(card.id)}
                  hintId={hintId}
                  onFocus={() => onFocusCard(card.id)}
                  onKey={keyOn(card.id)}
                  onDragStart={() => drag.start(card)}
                  onDragEnd={drag.end}
                  onDropOn={() => drag.drop(id, card.id)}
                />
              ))}
          </ColumnLane>
        );
      })}
    </>
  );
}
