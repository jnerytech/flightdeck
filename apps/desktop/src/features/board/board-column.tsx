import type { BoardColumn as ColumnId, ContractNeed } from "@flightdeck/protocol";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  Loader,
  type LucideIcon,
  Plus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnHandle } from "@/features/board/column-handle";
import { needsText } from "@/features/board/needs-badge";
import { cn } from "@/lib/utils";
import { Inline } from "@/shared/layout/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import { BoardColumnEmpty } from "./column-empty.tsx";

/** The icon of each column's status, drawn in the column's own tone. */
const COLUMN_ICONS: Record<ColumnId, LucideIcon> = {
  backlog: Circle,
  in_progress: Loader,
  waiting: CircleAlert,
  review: CircleCheck,
  done: CircleCheckBig,
};

/**
 * One column of the board: its head, what a drag would lack here, the cards (`children`), the
 * empty and no-match lines, the quick-add button and the width handle. The board keeps the cards
 * and every piece of state; the column only draws them and reports the drag and the add.
 */
export function ColumnLane(
  props: Readonly<{
    t: T;
    id: ColumnId;
    /** A narrow board shows one column at a time (the switcher): the others are hidden. */
    hidden: boolean;
    /** What the dragged cards would lack here: said by the column until they let go. */
    asking: ContractNeed[];
    /** A dragged card is over this column. */
    over: boolean;
    /** The count as shown, and in words for a screen reader. */
    count: string;
    label: string;
    /** No card of the project is in this column, and no card is hidden by a filter in it. */
    empty: boolean;
    noMatches: boolean;
    onAdd(): void;
    onDragEnter(): void;
    onDragLeave(): void;
    onDrop(): void;
    /** The width handle on the column's edge; absent where the switcher shows one column. */
    handle?: {
      width: number;
      index: number;
      last: boolean;
      onChange(next: number): void;
      onCommit(): void;
    };
    children: ReactNode;
  }>,
) {
  const { t, id, asking } = props;
  const title = t(`kanban.columns.${id}` as Key);
  return (
    <section
      hidden={props.hidden}
      aria-label={title}
      aria-describedby={asking.length > 0 ? `needs-${id}` : undefined}
      data-column={id}
      data-needs={asking.length > 0 ? "true" : undefined}
      className={cn(
        "board-column group/lane relative snap-start",
        props.over && "drop-over",
        asking.length > 0 && "column-needs",
      )}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={props.onDragEnter}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onDragLeave();
      }}
      onDrop={props.onDrop}
    >
      <ColumnHeader
        id={id}
        title={title}
        count={props.count}
        label={props.label}
        addLabel={t("kanban.addCardTo", { column: title })}
        onAdd={props.onAdd}
      />
      {asking.length > 0 && (
        <p id={`needs-${id}`} className="column-hint">
          {t("board.contract.hint", { needs: needsText(t, asking) })}
        </p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto empty:hidden">
        {props.children}
      </ul>
      {props.empty && (
        <BoardColumnEmpty
          label={t("kanban.emptyName", {
            empty: t("kanban.empty"),
            action: t("kanban.addCard"),
          })}
          text={t("kanban.empty")}
          onAdd={props.onAdd}
        />
      )}
      {props.noMatches && <p className="column-empty">{t("board.noMatches")}</p>}
      <Button
        variant="secondary"
        size="sm"
        aria-label={t("board.quickAdd", { column: title })}
        className="w-full focus-visible:opacity-100 group-hover/lane:opacity-100 [@media(hover:hover)]:opacity-0"
        onClick={props.onAdd}
      >
        <Plus aria-hidden="true" />
        {t("kanban.newCard")}
      </Button>
      {props.handle && <ColumnHandle t={t} {...props.handle} />}
    </section>
  );
}

/** A column's head: its status icon and name, the count as a pill, and a + that adds a card to it. */
function ColumnHeader(
  props: Readonly<{
    id: ColumnId;
    title: string;
    /** The count as shown: `n`, or `n / total` while a filter hides some. */
    count: string;
    /** The count in words, for a screen reader. */
    label: string;
    addLabel: string;
    onAdd(): void;
  }>,
) {
  const Icon = COLUMN_ICONS[props.id];
  return (
    <Inline gap={2} className="column-head flex-nowrap">
      <Icon data-slot="column-icon" aria-hidden="true" />
      <h3 className="column-title">{props.title}</h3>
      <Badge variant="secondary" className="column-count" role="img" aria-label={props.label}>
        <span aria-hidden="true">{props.count}</span>
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={props.addLabel}
        onClick={props.onAdd}
      >
        <Plus aria-hidden="true" />
      </Button>
    </Inline>
  );
}
