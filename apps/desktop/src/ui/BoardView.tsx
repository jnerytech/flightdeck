import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { Columns3, ListTodo, Lock, MoreHorizontal, Plus } from "lucide-react";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BoardNotice } from "@/components/board/board-notice";
import { BoardSyncControl } from "@/components/board/board-sync";
import { BulkDiscardDialog, hasStartedWork } from "@/components/board/bulk-discard-dialog";
import { ColumnHandle } from "@/components/board/column-handle";
import { ColumnHeader } from "@/components/board/column-header";
import { SelectionBar } from "@/components/board/selection-bar";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { AddProject } from "@/components/projects/add-project";
import { RoiCard } from "@/components/roi/roi-card";
import { StatusDot } from "@/components/status/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useT } from "@/i18n/context";
import { reasonText } from "@/lib/notice-text";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { Key } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { boardTitle, COLUMNS, filterCards, positionBefore, projectCards } from "../lib/board.ts";
import {
  answerOf,
  type BulkRefusal,
  columnCount,
  moveMany,
  pruneSelection,
  rangeSelection,
  shownSelection,
  toggleSelection,
} from "../lib/board-select.ts";
import { issueNumber } from "../lib/issues.ts";
import { statusTone } from "../lib/status.ts";
import { hasFeature } from "../lib/version.ts";
import { BoardColumnEmpty } from "./BoardColumnEmpty.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ExternalSeal, IssuesPanel } from "./IssuesPanel.tsx";

function CardTile(props: {
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
    selected: string;
  };
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
  /** A batch is running: the card cannot be dragged. */
  locked: boolean;
  onDropOn(): void;
  /** Whether the card is in the selection (issue #161). */
  selected: boolean;
  /** Ctrl-click and the menu: adds or takes out. Shift-click: the range from the anchor. */
  onToggleSelect(): void;
  onRangeSelect(): void;
}) {
  const t = useT();
  const { card } = props;
  /** The workflow (when its run is known) and the branch, when there are any. */
  const meta = [props.workflow, card.branch].filter(Boolean).join(" · ");
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Ctrl/Shift-click is the mouse's way to select; the card's menu has Select card for the keyboard
    <li
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
      onDrop={(e) => {
        e.stopPropagation();
        props.onDropOn();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-2">
          {card.sessionStatus && (
            <StatusDot
              tone={statusTone(card.sessionStatus)}
              label={t(`status.${card.sessionStatus}` as Key)}
              className="mt-1.5"
            />
          )}
          <button
            type="button"
            data-card-open
            className="min-w-0 text-left font-medium"
            onClick={(e) => {
              // A modified click selects (the tile handles it); only a plain one opens.
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) props.onOpen();
            }}
          >
            {card.title}
          </button>
          {props.selected && <span className="sr-only">{props.labels.selected}</span>}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={props.labels.actions}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={props.onStart}>{props.labels.start}</DropdownMenuItem>
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
        {card.queued && <Badge variant="outline">{t("kanban.queued")}</Badge>}
        {card.queueReason === "quota" && (
          <Badge variant="outline" className="text-status-needs-you">
            {card.quotaUntil
              ? t("kanban.waitingQuotaUntil", { time: props.formatTime(card.quotaUntil) })
              : t("kanban.waitingQuota")}
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
      </div>
      {card.notice && (
        <InlineNotice>
          {reasonText(t, card.notice, card.noticeReason, card.noticeParams)}
        </InlineNotice>
      )}
    </li>
  );
}

const BOARDVIEW_KEYS = ["runs", "hosts", "cards"] as const;

/** A project's board: five columns, drag and drop between and within them, text filter. */
/** A card that has a worktree, a branch or a session has work to clean up: it is discarded, not deleted. */
const hasStarted = hasStartedWork;

export const BoardView = memo(function BoardView(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string, edit?: boolean): void;
  /** A project was added from here: its board opens. */
  onOpenProject?(projectId: string): void;
}) {
  const { store, hostId, projectId } = props;
  const state = useStoreSlice(store, BOARDVIEW_KEYS);
  const [project, setProject] = useState<Project | null>(null);
  const [filter, setFilter] = useState("");
  /** Phase 31: only the cards that wait for a blocker. */
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /**
   * Card being dragged. A ref, not state: the drop may come before a re-render. Not in
   * DataTransfer either, which some webviews leave empty.
   */
  const dragging = useRef<string | null>(null);
  const loading = useMinLoading(project === null);
  /** The new-card dialog. */
  const [creating, setCreating] = useState(false);
  /** The card whose Delete… is asking for confirmation. */
  const [deleting, setDeleting] = useState<Card | null>(null);
  /** The column a dragged card is over. */
  const [over, setOver] = useState<string | null>(null);
  /** The issues panel (phase 13), on a daemon that announces issues. */
  const [issuesOpen, setIssuesOpen] = useState(false);
  /** The selected cards (Ctrl-click), the last one picked (the anchor of a Shift range) and what a bulk action left to say. */
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discardingMany, setDiscardingMany] = useState(false);
  // A batch of moves or discards is running: nothing else may start.
  const [busy, setBusy] = useState(false);
  /** The column a card is being created in from the bottom of a lane. */
  const [quickColumn, setQuickColumn] = useState<BoardColumn | null>(null);
  /** The cards dragged together when the dragged one is part of a selection. */
  const draggingMany = useRef<string[] | null>(null);
  const width = useSyncExternalStore(store.boardWidth.subscribe, () => store.boardWidth.value);
  const withDeps = hasFeature(
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "deps",
    false,
  );
  const withRoi = hasFeature(
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "roi",
    false,
  );
  const withSync = hasFeature(
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "boardsync",
    false,
  );
  const withIssues = hasFeature(
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "issues",
    false,
  );
  const { t } = store.i18n;

  useEffect(() => {
    void store.hostCommand(hostId, "board.get", { projectId }).then((board) => {
      if (board) setProject(board.project);
    });
  }, [store, hostId, projectId]);

  const all = projectCards(state, hostId, projectId);
  const shown = filterCards(all, filter).filter(
    (card) => !onlyBlocked || card.waitingOn.length > 0,
  );
  const filtering = filter.trim() !== "" || onlyBlocked;
  // The board's order: column by column, top to bottom, among the cards a filter leaves.
  const boardOrder = COLUMNS.flatMap(({ id }) =>
    shown.filter((card) => card.column === id).map((card) => card.id),
  );
  const selection = pruneSelection(
    picked,
    all.map((card) => card.id),
  );
  const acting = shownSelection(selection, boardOrder);
  const actingCards = acting.flatMap((id) => all.find((card) => card.id === id) ?? []);
  /** Moves the shown selected cards, quietly; the host's refusals are named afterwards. */
  const moveSelected = async (column: BoardColumn) => {
    if (busy) return;
    setBusy(true);
    const refused = await moveMany(actingCards, column, async (cardId, to) => {
      const answer = await store.hostRequest(hostId, "card.move", { cardId, column: to });
      return answer.ok ? { ok: true } : { ok: false, ...answerOf(answer) };
    });
    const stayed = refused.map((r) => r.card.id);
    setPicked((before) => before.filter((id) => stayed.includes(id) || !acting.includes(id)));
    setNotice(
      refused.length === 0
        ? null
        : refused.length === 1
          ? t("board.stayedOne", { names: nameRefusals(refused) })
          : t("board.stayed", { count: refused.length, names: nameRefusals(refused) }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  const nameRefusals = (refused: BulkRefusal[]) =>
    refused
      .map((r) => `${r.card.title} (${reasonText(t, r.message, r.reason, r.params)})`)
      .join(", ");
  /** Discards the started cards and deletes the others, one after the other. */
  const discardSelected = async () => {
    if (busy) return;
    const cards = actingCards;
    setDiscardingMany(false);
    setBusy(true);
    const failed: BulkRefusal[] = [];
    for (const card of cards) {
      const answer = await store.hostRequest(
        hostId,
        hasStartedWork(card) ? "card.discard" : "card.delete",
        { cardId: card.id, confirm: true },
      );
      if (!answer.ok) failed.push({ card, ...answerOf(answer) });
    }
    // A discard is not atomic on the host: a card it refused may be partly cleaned up, so it is
    // not left selected for a second try that would fail on what is already gone.
    setPicked((before) => before.filter((id) => !acting.includes(id)));
    setNotice(
      failed.length === 0
        ? null
        : failed.length === 1
          ? t("board.discardFailedOne", { names: nameRefusals(failed) })
          : t("board.discardFailed", { count: failed.length, names: nameRefusals(failed) }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  /** Clears the selection and keeps the focus on the board: the bar that had it goes away. */
  const clearSelection = () => {
    setPicked([]);
    boardRef.current?.focus();
  };
  const select = (card: Card) => {
    anchor.current = card.id;
    setPicked(toggleSelection(selection, card.id));
  };
  const selectRange = (card: Card) => {
    const order = shown.filter((other) => other.column === card.column).map((other) => other.id);
    setPicked(rangeSelection(order, anchor.current, card.id, selection));
    anchor.current = card.id;
  };
  const titlesOf = (ids: string[]) =>
    ids.map((id) => all.find((card) => card.id === id)?.title ?? id).join(", ");

  /** The card to focus once a move has happened: where it was, to tell when it has moved. */
  const refocus = useRef<{ cardId: string; column: BoardColumn; index: number } | null>(null);
  const columnOf = (column: BoardColumn) => all.filter((card) => card.column === column);
  const move = (cardId: string, column: BoardColumn, targetId?: string) => {
    const others = columnOf(column).filter((card) => card.id !== cardId);
    const position = targetId ? positionBefore(others, targetId) : undefined;
    void store.hostCommand(hostId, "card.move", {
      cardId,
      column,
      ...(position !== undefined ? { position } : {}),
    });
  };
  const drop = (column: BoardColumn, targetId?: string) => {
    const cardId = dragging.current;
    if (!cardId || busy) return;
    dragging.current = null;
    // A card dragged out of a selection takes the whole selection with it.
    if (draggingMany.current) {
      draggingMany.current = null;
      void moveSelected(column);
      return;
    }
    move(cardId, column, targetId);
  };
  /** The menu's moves for a card: to each other column, and up or down within its own. */
  const movesOf = (card: Card) => {
    const here = columnOf(card.column);
    const index = here.findIndex((other) => other.id === card.id);
    const go = (column: BoardColumn, targetId?: string) => () => {
      refocus.current = { cardId: card.id, column: card.column, index };
      move(card.id, column, targetId);
    };
    return [
      ...COLUMNS.filter(({ id }) => id !== card.column).map(({ id }) => ({
        key: id,
        label: t("board.moveTo", { column: t(`kanban.columns.${id}` as Key) }),
        onSelect: go(id),
      })),
      {
        key: "up",
        label: t("board.moveUp"),
        disabled: index <= 0,
        onSelect: go(card.column, here[index - 1]?.id),
      },
      {
        key: "down",
        label: t("board.moveDown"),
        disabled: index === here.length - 1,
        onSelect: go(card.column, here[index + 2]?.id),
      },
    ];
  };
  // After a move the card is somewhere else, so its old element is gone: focus the new one.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    const card = all.find((other) => other.id === wanted.cardId);
    if (!card) return;
    const index = columnOf(card.column).findIndex((other) => other.id === card.id);
    if (card.column === wanted.column && index === wanted.index) return;
    refocus.current = null;
    boardRef.current
      ?.querySelector<HTMLElement>(`li[data-card="${card.id}"] [data-card-open]`)
      ?.focus();
  });

  const create = () => {
    const column = quickColumn;
    const made = store.hostCommand(hostId, "card.create", {
      projectId,
      title: title.trim(),
      description,
    });
    close();
    // Made from the bottom of a lane, the card goes to that lane.
    if (column && column !== "backlog") {
      void made.then((card) => {
        if (card) void store.hostCommand(hostId, "card.move", { cardId: card.id, column });
      });
    }
    return made;
  };
  /** Closes the dialog and forgets what was typed. */
  const close = () => {
    setCreating(false);
    setQuickColumn(null);
    setTitle("");
    setDescription("");
  };

  return (
    <Page
      title={boardTitle(t, project?.name)}
      toolbar={
        <Toolbar label={t("hub.filters")}>
          <Input
            aria-label={t("kanban.filter")}
            placeholder={t("hub.filterPlaceholder")}
            className="h-8 w-40 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {withDeps && (
            <Button
              size="sm"
              variant="outline"
              aria-pressed={onlyBlocked}
              onClick={() => setOnlyBlocked(!onlyBlocked)}
            >
              <Lock aria-hidden="true" />
              {t("deps.filter")}
            </Button>
          )}
          {withSync && <BoardSyncControl store={store} hostId={hostId} projectId={projectId} />}
          {withIssues && (
            <Button size="sm" variant="outline" onClick={() => setIssuesOpen(true)}>
              <ListTodo aria-hidden="true" />
              {t("issuesUi.button")}
            </Button>
          )}
          <AddProject
            store={store}
            hostId={hostId}
            variant="outline"
            onAdded={(added) => props.onOpenProject?.(added.id)}
          />
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("kanban.newCard")}
          </Button>
        </Toolbar>
      }
    >
      <div className="flex flex-col gap-4">
        {withRoi && project && <RoiCard store={store} hostId={hostId} project={project} />}
        {loading && <LoadingState label={t("states.loadingBoard")} shape="columns" />}
        {!loading && project && all.length === 0 && (
          <EmptyState
            icon={Columns3}
            title={t("states.emptyCards")}
            action={<Button onClick={() => setCreating(true)}>{t("states.newCard")}</Button>}
          />
        )}
        {selection.length > 0 && (
          <SelectionBar
            t={t}
            shown={acting.length}
            hidden={selection.length - acting.length}
            onMove={(column) => void moveSelected(column)}
            onDiscard={() => setDiscardingMany(true)}
            onClear={clearSelection}
            busy={busy}
            onEscape={clearSelection}
          />
        )}
        {notice && (
          <BoardNotice
            text={notice}
            dismiss={t("board.dismiss")}
            onDismiss={() => setNotice(null)}
          />
        )}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc clears the selection from any card inside the board */}
        <div
          ref={boardRef}
          data-slot="board-grid"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the columns scroll sideways; focus lets the keyboard do it
          tabIndex={0}
          style={{ gridAutoColumns: `${width}px` }}
          className="grid grid-flow-col gap-3 overflow-x-auto pb-2"
          onKeyDown={(e) => {
            // Only the board's own Esc: one that closes a card's menu is the menu's.
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (!e.currentTarget.contains(e.target as Node)) return;
            if (selection.length > 0) clearSelection();
          }}
        >
          {COLUMNS.map(({ id }) => (
            <section
              key={id}
              aria-label={t(`kanban.columns.${id}` as Key)}
              className={cn(
                "group/lane relative flex min-h-32 flex-col gap-2 rounded-lg bg-secondary/50 p-2",
                over === id && "drop-over",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setOver(id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={() => {
                setOver(null);
                drop(id);
              }}
            >
              <ColumnHeader
                title={t(`kanban.columns.${id}` as Key)}
                count={columnCount(
                  shown.filter((card) => card.column === id).length,
                  all.filter((card) => card.column === id).length,
                  filtering,
                )}
              />
              <ul className="flex flex-col gap-2">
                {shown
                  .filter((card) => card.column === id)
                  .map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      workflow={
                        card.workflowRunId
                          ? state.runs[sessionKey(hostId, card.workflowRunId)]?.workflowName
                          : undefined
                      }
                      formatTime={(iso) => store.formatTime(iso)}
                      labels={{
                        actions: store.i18n.t("board.cardActions", { title: card.title }),
                        start: store.i18n.t("board.startCard"),
                        edit: store.i18n.t("board.edit"),
                        delete: store.i18n.t("board.delete"),
                        select: t("board.selectCard"),
                        deselect: t("board.deselectCard"),
                        selected: t("board.selectedCard"),
                      }}
                      deps={{
                        waiting: titlesOf(card.waitingOn),
                        holding: titlesOf(card.blocking),
                      }}
                      moves={movesOf(card)}
                      onOpen={() => props.onOpenCard(card.id)}
                      onEdit={() => props.onOpenCard(card.id, true)}
                      onDelete={() => setDeleting(card)}
                      onStart={() =>
                        void store.hostCommand(hostId, "card.start", { cardId: card.id })
                      }
                      locked={busy}
                      selected={selection.includes(card.id)}
                      onToggleSelect={() => select(card)}
                      onRangeSelect={() => selectRange(card)}
                      onDragStart={() => {
                        dragging.current = card.id;
                        draggingMany.current =
                          acting.includes(card.id) && acting.length > 1 ? acting : null;
                      }}
                      onDropOn={() => {
                        setOver(null);
                        drop(id, card.id);
                      }}
                    />
                  ))}
              </ul>
              {all.every((card) => card.column !== id) && (
                <BoardColumnEmpty label={t("kanban.addCard")} onAdd={() => setCreating(true)} />
              )}
              {filtering &&
                all.some((card) => card.column === id) &&
                shown.every((card) => card.column !== id) && (
                  <p className="px-1 text-muted-foreground text-xs">{t("board.noMatches")}</p>
                )}
              <Button
                variant="secondary"
                size="sm"
                aria-label={t("board.quickAdd", { column: t(`kanban.columns.${id}` as Key) })}
                className="w-full focus-visible:opacity-100 group-hover/lane:opacity-100 [@media(hover:hover)]:opacity-0"
                onClick={() => {
                  setQuickColumn(id);
                  setCreating(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t("kanban.newCard")}
              </Button>
              <ColumnHandle t={t} width={width} onChange={(next) => store.boardWidth.set(next)} />
            </section>
          ))}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          message={
            hasStarted(deleting)
              ? t("board.deleteStarted", { title: deleting.title })
              : t("board.deleteMessage", { title: deleting.title })
          }
          confirmLabel={hasStarted(deleting) ? t("board.discardInstead") : t("board.deleteConfirm")}
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const card = deleting;
            setDeleting(null);
            // A started card has work to clean up, so it goes through the existing discard.
            void store.hostCommand(hostId, hasStarted(card) ? "card.discard" : "card.delete", {
              cardId: card.id,
              confirm: true,
            });
          }}
        />
      )}
      {discardingMany && (
        <BulkDiscardDialog
          cards={actingCards}
          t={t}
          onCancel={() => setDiscardingMany(false)}
          onConfirm={() => void discardSelected()}
        />
      )}
      {issuesOpen && project && (
        <IssuesPanel
          store={store}
          hostId={hostId}
          project={project}
          cards={all}
          onClose={() => setIssuesOpen(false)}
          onProject={setProject}
          onOpenCard={props.onOpenCard}
        />
      )}
      <Dialog open={creating} onOpenChange={(open) => (open ? setCreating(true) : close())}>
        <AppDialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("kanban.newCard")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Input
              aria-label={t("kanban.titleLabel")}
              placeholder={t("kanban.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              aria-label={t("kanban.descriptionLabel")}
              placeholder={t("kanban.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <ActionButton
                type="submit"
                disabled={!title.trim()}
                disabledReason={t("kanban.needTitle")}
              >
                {t("kanban.create")}
              </ActionButton>
            </DialogFooter>
          </form>
        </AppDialogContent>
      </Dialog>
    </Page>
  );
});
