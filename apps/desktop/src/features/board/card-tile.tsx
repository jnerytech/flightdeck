import type { Card, ContractOverrides } from "@flightdeck/protocol";
import { MoreHorizontal } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showsQueuedBadge } from "@/features/board/domain/board-derive";
import { NeedsBadge } from "@/features/board/needs-badge";
import { QuietBadge } from "@/features/board/quiet-badge";
import { RadarBadge } from "@/features/board/radar-badge";
import { useT } from "@/i18n/context";
import { reasonText } from "@/i18n/errors";
import { cn } from "@/lib/utils";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { statusTone } from "@/shared/lib/index.ts";
import { StatusDot } from "@/shared/status/index.ts";
import type { Key } from "../../i18n/index.ts";
import { issueNumber } from "../issues/index.ts";
import { ExternalSeal } from "../issues/ui.ts";
import { missingFor } from "./domain/board-contracts.ts";
import type { BoardKeyAction } from "./domain/board-keys.ts";
import { radarBadge } from "./domain/conflict-radar.ts";

/** What a card's own text lacks: fixed in its fields, not on the card's run (#1197). */
const FIELD_NEEDS: ReadonlySet<string> = new Set(["criteria", "validation", "spec"]);

export function CardTile(
  props: Readonly<{
    card: Card;
    /** The name of the workflow the card is running, when known. */
    workflow?: string;
    formatTime(iso: string): string;
    labels: {
      actions: string;
      start: string;
      edit: string;
      delete: string;
      select: string;
      deselect: string;
      /** #1354: the name of the card's check, "Select {title}". */
      selectNamed: string;
    };
    /** Why "Iniciar card" is off (queued or running), else null. */
    startOff: string | null;
    /** Phase 31: the titles of the cards it waits for and of those it holds up. */
    deps: { waiting: string; holding: string };
    /** The ways to move the card without dragging it, in menu order. */
    moves: Array<{ key: string; label: string; disabled?: boolean; onSelect(): void }>;
    onOpen(): void;
    /** "Iniciar card" from the card's menu, without opening it (phase 10). */
    onStart(): void;
    /** Opens the card with its title ready to edit. */
    onEdit(): void;
    /** Asks to delete the card (a card that already started is offered Discard instead). */
    onDelete(): void;
    onDragStart(): void;
    onDragEnd(): void;
    /** A batch is running: the card cannot be dragged. */
    locked: boolean;
    onDropOn(): void;
    /** Whether the card is in the selection (issue #161). */
    selected: boolean;
    /** #1354: a selection exists, so the card shows its check and `s` starts no single card. */
    selecting: boolean;
    /** #1354: `m` with a selection opens the bar's Move to…, not the card's menu. */
    onMoveSelection(): void;
    /** #1354: `s` with a selection asks to start the selection. */
    onStartSelection(): void;
    /** What the project's columns ask of a card (issue #78). */
    contracts: ContractOverrides;
    /** #1553: the card's session says nothing: the badge's words, and its full status line. */
    quiet: { short: string; full: string } | null;
    /** Ctrl-click and the menu: adds or takes out. Shift-click: the range from the anchor. */
    onToggleSelect(): void;
    onRangeSelect(): void;
    /** Its column's one Tab stop (#1198): the other cards are reached with the arrows. */
    tabbable: boolean;
    /** The id of the line that says the board's keys. */
    hintId: string;
    onFocus(): void;
    /** What a key on the card's title does; the board moves the focus itself. */
    onKey(e: KeyboardEvent<HTMLButtonElement>): BoardKeyAction;
  }>,
) {
  const t = useT();
  const { card } = props;
  const radar = radarBadge(card, t);
  /** The card's menu, opened by its ⋯ or by `m` (#1198). */
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  /** The workflow (when its run is known) and the branch, when there are any. */
  const meta = [props.workflow, card.branch].filter(Boolean).join(" · ");
  /** What its column asks and it lacks (issue #78): said on the card, whether or not it was asked. */
  const needs = missingFor(card.column, card, props.contracts);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Ctrl/Shift-click is the mouse's way to select; the card's menu has Select card for the keyboard
    <li // NOSONAR: Ctrl/Shift-click is the mouse's way to select; the card's menu has Select card for the keyboard
      draggable={!props.locked}
      data-card={card.id}
      data-selected={props.selected ? "true" : undefined}
      aria-label={t("kanban.card", { title: card.title })}
      className={cn(
        "flex cursor-grab flex-col gap-2 rounded-md border bg-card p-2 text-sm hover:bg-accent",
        props.selected && "bg-accent ring-1 ring-ring",
      )}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) props.onToggleSelect();
        else if (e.shiftKey) props.onRangeSelect();
      }}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDrop={(e) => {
        e.stopPropagation();
        props.onDropOn();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-2">
          {props.selecting && (
            // #1354: a 16 px box in a 24 px target; not a Tab stop, `x` is its key (#1198).
            <span className="card-check hit-control">
              <input
                type="checkbox"
                tabIndex={-1}
                checked={props.selected}
                aria-label={props.labels.selectNamed}
                onChange={() => {
                  props.onToggleSelect();
                  // The keys live on the title: a click on the check leaves the focus there.
                  titleRef.current?.focus();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
          )}
          {card.sessionStatus && (
            <StatusDot
              tone={statusTone(card.sessionStatus)}
              label={t(`status.${card.sessionStatus}` as Key)}
              className="mt-1.5"
            />
          )}
          <button
            ref={titleRef}
            type="button"
            data-card-open
            tabIndex={props.tabbable ? 0 : -1}
            aria-describedby={props.hintId}
            aria-keyshortcuts="S M X"
            className="min-w-0 text-left font-medium"
            onFocus={props.onFocus}
            onKeyDown={(e) => {
              const action = props.onKey(e);
              if (!action) return;
              e.preventDefault();
              // With a selection, s and m are the selection's (#1354), never a single card's.
              if (action.kind === "start") {
                if (props.selecting) props.onStartSelection();
                else if (props.startOff === null) props.onStart();
              }
              if (action.kind === "menu") {
                if (props.selecting) props.onMoveSelection();
                else setMenuOpen(true);
              }
            }}
            onClick={(e) => {
              // A modified click selects (the tile handles it); only a plain one opens.
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) props.onOpen();
            }}
          >
            {card.title}
          </button>
        </span>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            {/* Not a Tab stop (#1198): `m` on the card opens it, so each column stays one stop. */}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              tabIndex={-1}
              aria-label={props.labels.actions}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            onCloseAutoFocus={(e) => {
              // Back to the card's title, its column's Tab stop, unless a move took the card away.
              if (!titleRef.current?.isConnected) return;
              e.preventDefault();
              titleRef.current.focus();
            }}
          >
            <DropdownMenuItem disabled={props.startOff !== null} onSelect={props.onStart}>
              {props.startOff ? `${props.labels.start} · ${props.startOff}` : props.labels.start}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onToggleSelect}>
              {props.selected ? props.labels.deselect : props.labels.select}
            </DropdownMenuItem>
            {props.moves.map((move) => (
              <DropdownMenuItem key={move.key} disabled={move.disabled} onSelect={move.onSelect}>
                {move.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={props.onEdit}>{props.labels.edit}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onDelete}>{props.labels.delete}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {meta && (
        <p data-slot="card-meta" className="truncate text-muted-foreground text-xs">
          {meta}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* A reason badge below says the card is queued, and why: one badge, not "queued" beside it. */}
        {showsQueuedBadge(card) && <Badge variant="outline">{t("kanban.queued")}</Badge>}
        {card.queueReason === "quota" && (
          <Badge variant="outline" className="text-status-needs-you">
            {card.quotaUntil
              ? t("kanban.waitingQuotaUntil", { time: props.formatTime(card.quotaUntil) })
              : t("kanban.waitingQuota")}
          </Badge>
        )}
        {radar && <RadarBadge text={radar} />}
        {props.quiet && <QuietBadge short={props.quiet.short} full={props.quiet.full} />}
        {card.queueReason === "memory" && (
          <Badge variant="outline" className="text-status-needs-you">
            {t("kanban.waitingMemory")}
          </Badge>
        )}
        {card.queueReason === "paused" && (
          <Badge variant="outline" className="text-status-needs-you">
            {t("kanban.waitingPaused")}
          </Badge>
        )}
        {card.waitingOn.length > 0 && (
          <Badge
            variant="outline"
            className="text-status-needs-you"
            title={t("deps.blockedTip", { titles: props.deps.waiting })}
          >
            {t("deps.blocked", { count: card.waitingOn.length })}
          </Badge>
        )}
        {card.blocking.length > 0 && (
          <Badge variant="outline" title={t("deps.blockingTip", { titles: props.deps.holding })}>
            {t("deps.blocking", { count: card.blocking.length })}
          </Badge>
        )}
        {card.unblockedAt && <Badge variant="outline">{t("deps.unblocked")}</Badge>}
        {card.issueRef && <Badge variant="outline">{issueNumber(card.issueRef)}</Badge>}
        {card.issueExternal && <ExternalSeal t={t} />}
        {card.prState && <Badge variant="outline">{t(`pr.${card.prState}` as Key)}</Badge>}
        {card.checksState && (
          <Badge variant="outline">{t(`checks.${card.checksState}` as Key)}</Badge>
        )}
        {needs.length > 0 && (
          <NeedsBadge
            t={t}
            needs={needs}
            // What the card's text lacks is fixed in its fields; a PR and checks, on the card.
            onFix={() =>
              needs.some((need) => FIELD_NEEDS.has(need)) ? props.onEdit() : props.onOpen()
            }
          />
        )}
      </div>
      {card.notice && (
        <InlineNotice>
          {reasonText(t, card.notice, card.noticeReason, card.noticeParams)}
        </InlineNotice>
      )}
    </li>
  );
}
