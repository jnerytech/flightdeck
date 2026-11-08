import type { BoardColumn, Card, ContractOverrides, Project } from "@flightdeck/protocol";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  Columns3,
  FolderOpen,
  ListTodo,
  Loader,
  Lock,
  type LucideIcon,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BoardNotice } from "@/components/board/board-notice";
import { BoardStatus } from "@/components/board/board-status";
import { BoardSyncControl } from "@/components/board/board-sync";
import { BulkDiscardDialog, hasStartedWork } from "@/components/board/bulk-discard-dialog";
import { ColumnHandle } from "@/components/board/column-handle";
import { ContractDialog } from "@/components/board/contract-dialog";
import { NeedsBadge, needsText } from "@/components/board/needs-badge";
import { SelectionBar, SelectionSlot } from "@/components/board/selection-bar";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Inline, Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { AddProject } from "@/components/projects/add-project";
import { WorktreeChip } from "@/components/projects/worktree-chip";
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
import { useStartAsk } from "@/hooks/use-start-ask";
import { useT } from "@/i18n/context";
import { reasonText } from "@/lib/notice-text";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { AssistField } from "../components/assistant/assist-field.tsx";
import { CardStartDialog } from "../components/board/card-start-dialog.tsx";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { Key, T } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import {
  boardTitle,
  COLUMNS,
  filterCards,
  positionBefore,
  positionsBefore,
  projectCards,
} from "../lib/board.ts";
import { askAbout, dragNeeds, type Lacking, missingFor } from "../lib/board-contracts.ts";
import { boardFiles } from "../lib/board-files.ts";
import {
  answerOf,
  type BulkRefusal,
  COLUMN_GAP,
  columnCount,
  countLabel,
  filteredColumnCount,
  filteredCountLabel,
  fitColumnWidth,
  moveMany,
  pruneSelection,
  rangeSelection,
  shownSelection,
  toggleSelection,
} from "../lib/board-select.ts";
import { cardStartBlock } from "../lib/card-start-block.ts";
import { issueNumber } from "../lib/issues.ts";
import { activeWorktreeFilter, cardInFilter } from "../lib/project-tree.ts";
import { statusTone } from "../lib/status.ts";
import { useWidth } from "../lib/use-width.ts";
import { hasFeature } from "../lib/version.ts";
import { BoardColumnEmpty } from "./BoardColumnEmpty.tsx";
import { BoardFilesPanel } from "./BoardFiles.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { ExternalSeal, IssuesPanel } from "./IssuesPanel.tsx";

/** The icon of each column's status, drawn in the column's own tone. */
const COLUMN_ICONS: Record<BoardColumn, LucideIcon> = {
  backlog: Circle,
  in_progress: Loader,
  waiting: CircleAlert,
  review: CircleCheck,
  done: CircleCheckBig,
};

/** Why "Iniciar card" is off (queued or running), else null. */
function startOffText(block: ReturnType<typeof cardStartBlock>, t: T): string | null {
  if (block === "queued") return t("board.startQueued");
  return block === "running" ? t("board.startRunning") : null;
}

function CardTile(
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
      selected: string;
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
    /** What the project's columns ask of a card (issue #78). */
    contracts: ContractOverrides;
    /** Ctrl-click and the menu: adds or takes out. Shift-click: the range from the anchor. */
    onToggleSelect(): void;
    onRangeSelect(): void;
  }>,
) {
  const t = useT();
  const { card } = props;
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
        {needs.length > 0 && <NeedsBadge t={t} needs={needs} />}
      </div>
      {card.notice && (
        <InlineNotice>
          {reasonText(t, card.notice, card.noticeReason, card.noticeParams)}
        </InlineNotice>
      )}
    </li>
  );
}

const BOARDVIEW_KEYS = ["runs", "hosts", "projects", "cards", "worktreeFilter"] as const;

/** A project's board: five columns, drag and drop between and within them, text filter. */
/** A card that has a worktree, a branch or a session has work to clean up: it is discarded, not deleted. */
const hasStarted = hasStartedWork;

export const BoardView = memo(function BoardView(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string, edit?: boolean): void;
  /** Opens Settings, section Assistant (the wand found no provider). */
  onOpenSettings(): void;
  /** A project was added from here: its board opens. */
  onOpenProject?(projectId: string): void;
}) {
  const { store, hostId, projectId } = props;
  const state = useStoreSlice(store, BOARDVIEW_KEYS);
  const [project, setProject] = useState<Project | null>(null);
  const contracts: ContractOverrides = project?.contractByColumn ?? {};
  /** Starting a card with no acceptance criteria asks first (issue #78). */
  const startAsk = useStartAsk({
    restoreFocus: (cardId) =>
      document.querySelector<HTMLElement>(`[data-card="${cardId}"] [data-card-open]`)?.focus(),
  });
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
  const [starting, setStarting] = useState<Card | null>(null);
  /** The card whose Delete… is asking for confirmation. */
  const [deleting, setDeleting] = useState<Card | null>(null);
  /** The column a new card goes to: the one whose + was pressed. */
  const [createIn, setCreateIn] = useState<BoardColumn>("backlog");
  /** The column a dragged card is over. */
  const [over, setOver] = useState<string | null>(null);
  /** The cards being dragged: the columns that ask for something say what, until they let go. */
  const [dragCards, setDragCards] = useState<Card[]>([]);
  /** A move waiting on the person's answer: the cards lack something its column asks (issue #78). */
  const [ask, setAsk] = useState<{
    column: BoardColumn;
    targetId?: string;
    cards: Card[];
    lacking: Lacking[];
  } | null>(null);
  /** The issues panel (phase 13), on a daemon that announces issues. */
  const [issuesOpen, setIssuesOpen] = useState(false);
  /** The selected cards (Ctrl-click), the last one picked (the anchor of a Shift range) and what a bulk action left to say. */
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discardingMany, setDiscardingMany] = useState(false);
  // A batch of moves or discards is running: nothing else may start.
  const [busy, setBusy] = useState(false);
  /** The cards dragged together when the dragged one is part of a selection. */
  const draggingMany = useRef<string[] | null>(null);
  const chosenWidth = useSyncExternalStore(
    store.boardWidth.subscribe,
    () => store.boardWidth.value,
  );
  const chosen = useSyncExternalStore(store.boardWidth.subscribe, () => store.boardWidth.chosen);
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
  /** Files pressed for a checkout (#117): another checkout goes back to the default. */
  const [filesChoice, setFilesChoice] = useState<{ path: string; open: boolean } | null>(null);
  /** The board's width: under 900 px the panel would squeeze the columns, so it takes their place. */
  const splitRef = useRef<HTMLDivElement>(null);
  const splitWidth = useWidth(splitRef);
  const narrow = splitWidth > 0 && splitWidth < 900;
  const { t } = store.i18n;

  useEffect(() => {
    void store.hostCommand(hostId, "board.get", { projectId }).then((board) => {
      if (board) setProject(board.project);
    });
  }, [store, hostId, projectId]);
  // The sidebar's Board item opens this board next time on this host (#669).
  useEffect(() => store.rememberBoard(hostId, projectId), [store, hostId, projectId]);

  const all = projectCards(state, hostId, projectId);
  // The branch picked in the sidebar tree keeps the cards of that checkout (of this project only).
  const active = activeWorktreeFilter(state);
  const treeBranch = active?.hostId === hostId && active.projectId === projectId ? active : null;
  const shown = filterCards(all, filter)
    .filter((card) => !onlyBlocked || card.waitingOn.length > 0)
    .filter((card) => !treeBranch || cardInFilter(card, treeBranch));
  const files = boardFiles(
    treeBranch,
    all,
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
  );
  // Wide, a picked worktree shows its files at once; narrow, they wait for the Files button.
  const filesShown =
    files !== null &&
    (filesChoice !== null && filesChoice.path === treeBranch?.path ? filesChoice.open : !narrow);
  const filtering = filter.trim() !== "" || onlyBlocked;
  const counts = (inColumn: number, ofColumn: number) =>
    filtering
      ? {
          count: filteredColumnCount(inColumn, ofColumn),
          label: filteredCountLabel(t, inColumn, ofColumn),
        }
      : { count: columnCount(inColumn), label: countLabel(t, inColumn) };
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
  const moveSelected = async (
    column: BoardColumn,
    targetId?: string,
    only?: Card[],
    force = false,
  ) => {
    if (busy) return;
    // One question for the whole group; a group already asked about (`only`) goes straight on.
    if (!only) {
      const lacking = askAbout(column, actingCards, contracts);
      if (lacking.length > 0) {
        setAsk({ column, targetId, cards: actingCards, lacking });
        return;
      }
    }
    const cards = only ?? actingCards;
    const ids = cards.map((card) => card.id);
    setBusy(true);
    // Dropped on a card, the group lands before it, in the board's order.
    const positions =
      targetId && !ids.includes(targetId)
        ? positionsBefore(
            columnOf(column).filter((card) => !ids.includes(card.id)),
            targetId,
            cards.length,
          )
        : undefined;
    const refused = await moveMany(
      cards,
      column,
      async (cardId, to, position) => {
        const answer = await store.hostRequest(hostId, "card.move", {
          cardId,
          column: to,
          ...(position !== undefined ? { position } : {}),
          ...(force ? { force } : {}),
        });
        return answer.ok ? { ok: true } : { ok: false, ...answerOf(answer) };
      },
      positions,
    );
    const stayed = refused.map((r) => r.card.id);
    setPicked((before) => before.filter((id) => stayed.includes(id) || !ids.includes(id)));
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
    // Only a card just selected anchors the next Shift-click.
    if (!selection.includes(card.id)) anchor.current = card.id;
    else if (anchor.current === card.id) anchor.current = null;
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
  const columnOf = (column: BoardColumn) =>
    all.filter((card) => card.column === column).sort((a, b) => a.position - b.position);
  const runMove = (cardId: string, column: BoardColumn, targetId?: string, force = false) => {
    const others = columnOf(column).filter((card) => card.id !== cardId);
    const position = targetId ? positionBefore(others, targetId) : undefined;
    void store.hostCommand(hostId, "card.move", {
      cardId,
      column,
      ...(position !== undefined ? { position } : {}),
      ...(force ? { force } : {}),
    });
  };
  /** A person's move of one card: a column that asks for something asks first (issue #78). */
  const move = (cardId: string, column: BoardColumn, targetId?: string) => {
    const card = all.find((other) => other.id === cardId);
    const lacking = card ? askAbout(column, [card], contracts) : [];
    if (card && lacking.length > 0) setAsk({ column, targetId, cards: [card], lacking });
    else runMove(cardId, column, targetId);
  };
  const drop = (column: BoardColumn, targetId?: string) => {
    const cardId = dragging.current;
    if (!cardId || busy) return;
    dragging.current = null;
    setDragCards([]);
    // A card dragged out of a selection takes the whole selection with it.
    if (draggingMany.current) {
      draggingMany.current = null;
      void moveSelected(column, targetId);
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
  // Until the person picks a width, the columns share what the window gives them (#1030).
  const boardPx = useWidth(boardRef);
  const width = chosen ? chosenWidth : fitColumnWidth(boardPx, COLUMNS.length, COLUMN_GAP);
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

  const create = async () => {
    // The column whose + was pressed is part of the command: one step, nothing to move afterwards.
    const made = await store.hostCommand(hostId, "card.create", {
      projectId,
      title: title.trim(),
      description,
      ...(createIn === "backlog" ? {} : { column: createIn }),
    });
    // Issue #229: only a card that exists closes the dialog; a refused one keeps what was typed
    // (the banner says why). A made card says so, with a way to open it (issue #188).
    if (!made) return made;
    close();
    store.success(t("kanban.created", { title: made.title }), {
      label: t("kanban.openCard"),
      run: () => props.onOpenCard(made.id),
    });
    return made;
  };
  /** Closes the dialog and forgets what was typed. */
  const close = () => {
    setCreating(false);
    setCreateIn("backlog");
    setTitle("");
    setDescription("");
  };

  return (
    // The board fills its page (#641): the columns row takes the rest of the height and scrolls
    // sideways at the window's bottom, and each column's cards scroll by themselves.
    <Page
      fill
      title={boardTitle(t, project?.name)}
      toolbar={
        <>
          <SelectionSlot
            bar={
              selection.length > 0 && (
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
              )
            }
          >
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
              {files && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={filesShown}
                  onClick={() =>
                    setFilesChoice({ path: treeBranch?.path ?? "", open: !filesShown })
                  }
                >
                  <FolderOpen aria-hidden="true" />
                  {t("board.files")}
                </Button>
              )}
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
          </SelectionSlot>
          {treeBranch && (
            <WorktreeChip filter={treeBranch} t={t} onClear={() => store.setWorktreeFilter(null)} />
          )}
        </>
      }
    >
      <div className="board-body">
        {withRoi && project && <RoiCard store={store} hostId={hostId} project={project} />}
        {loading && <LoadingState label={t("states.loadingBoard")} shape="columns" />}
        {!loading && project && all.length === 0 && (
          <EmptyState
            icon={Columns3}
            title={t("states.emptyCards")}
            action={<Button onClick={() => setCreating(true)}>{t("states.newCard")}</Button>}
          />
        )}
        <BoardStatus
          text={[
            selection.length === 0
              ? ""
              : acting.length === 1
                ? t("board.selectedOne")
                : t("board.selectedCount", { n: acting.length }),
            notice ?? "",
          ]
            .filter(Boolean)
            .join(". ")}
        />
        {notice && (
          <BoardNotice
            text={notice}
            dismiss={t("board.dismiss")}
            onDismiss={() => setNotice(null)}
          />
        )}
        <div ref={splitRef} className="board-split" data-narrow={narrow || undefined}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc clears the selection from any card inside the board */}
          <div
            ref={boardRef}
            data-slot="board-columns"
            hidden={narrow && filesShown}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the columns scroll sideways; focus lets the keyboard do it
            tabIndex={0}
            style={{ gridAutoColumns: `${width}px` }}
            className="grid min-h-48 flex-1 grid-flow-col gap-3 overflow-x-auto pb-2 @max-[40rem]:snap-x @max-[40rem]:snap-mandatory"
            onKeyDown={(e) => {
              // Only the board's own Esc: one that closes a card's menu is the menu's.
              if (e.key !== "Escape" || e.defaultPrevented) return;
              if (!e.currentTarget.contains(e.target as Node)) return;
              if (selection.length > 0) clearSelection();
            }}
          >
            {COLUMNS.map(({ id }) => {
              /** What the dragged cards would lack here: said by the column until they let go. */
              const asking = dragNeeds(id, dragCards, contracts);
              return (
                <section
                  key={id}
                  aria-label={t(`kanban.columns.${id}` as Key)}
                  aria-describedby={asking.length > 0 ? `needs-${id}` : undefined}
                  data-column={id}
                  data-needs={asking.length > 0 ? "true" : undefined}
                  className={cn(
                    "board-column group/lane relative snap-start",
                    over === id && "drop-over",
                    asking.length > 0 && "column-needs",
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
                    id={id}
                    title={t(`kanban.columns.${id}` as Key)}
                    {...counts(
                      shown.filter((card) => card.column === id).length,
                      all.filter((card) => card.column === id).length,
                    )}
                    addLabel={t("kanban.addCardTo", { column: t(`kanban.columns.${id}` as Key) })}
                    onAdd={() => {
                      setCreateIn(id);
                      setCreating(true);
                    }}
                  />
                  {asking.length > 0 && (
                    <p id={`needs-${id}`} className="column-hint">
                      {t("board.contract.hint", { needs: needsText(t, asking) })}
                    </p>
                  )}
                  <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto empty:hidden">
                    {shown
                      .filter((card) => card.column === id)
                      .map((card) => (
                        <CardTile
                          key={card.id}
                          card={card}
                          contracts={contracts}
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
                          startOff={startOffText(cardStartBlock(card), store.i18n.t)}
                          deps={{
                            waiting: titlesOf(card.waitingOn),
                            holding: titlesOf(card.blocking),
                          }}
                          moves={movesOf(card)}
                          onOpen={() => props.onOpenCard(card.id)}
                          onEdit={() => props.onOpenCard(card.id, true)}
                          onDelete={() => setDeleting(card)}
                          onStart={() => startAsk.ask(card, contracts, () => setStarting(card))}
                          locked={busy}
                          selected={selection.includes(card.id)}
                          onToggleSelect={() => select(card)}
                          onRangeSelect={() => selectRange(card)}
                          onDragStart={() => {
                            dragging.current = card.id;
                            draggingMany.current =
                              acting.includes(card.id) && acting.length > 1 ? acting : null;
                            setDragCards(draggingMany.current ? actingCards : [card]);
                          }}
                          onDragEnd={() => setDragCards([])}
                          onDropOn={() => {
                            setOver(null);
                            drop(id, card.id);
                          }}
                        />
                      ))}
                  </ul>
                  {all.every((card) => card.column !== id) && (
                    <BoardColumnEmpty
                      label={t("kanban.emptyName", {
                        empty: t("kanban.empty"),
                        action: t("kanban.addCard"),
                      })}
                      text={t("kanban.empty")}
                      onAdd={() => {
                        setCreateIn(id);
                        setCreating(true);
                      }}
                    />
                  )}
                  {filtering &&
                    all.some((card) => card.column === id) &&
                    shown.every((card) => card.column !== id) && (
                      <p className="column-empty">{t("board.noMatches")}</p>
                    )}
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t("board.quickAdd", { column: t(`kanban.columns.${id}` as Key) })}
                    className="w-full focus-visible:opacity-100 group-hover/lane:opacity-100 [@media(hover:hover)]:opacity-0"
                    onClick={() => {
                      setCreateIn(id);
                      setCreating(true);
                    }}
                  >
                    <Plus aria-hidden="true" />
                    {t("kanban.newCard")}
                  </Button>
                  <ColumnHandle
                    t={t}
                    width={width}
                    index={COLUMNS.findIndex((column) => column.id === id) + 1}
                    last={id === COLUMNS[COLUMNS.length - 1]?.id}
                    onChange={(next) => store.boardWidth.set(next, false)}
                    onCommit={() => store.boardWidth.persist()}
                  />
                </section>
              );
            })}
          </div>
          {filesShown && <BoardFilesPanel store={store} hostId={hostId} files={files} />}
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
      {ask && (
        <ContractDialog
          t={t}
          column={t(`kanban.columns.${ask.column}` as Key)}
          lacking={ask.lacking}
          qualifying={ask.cards.length - ask.lacking.length}
          onRestoreFocus={(cardId) =>
            document.querySelector<HTMLElement>(`[data-card="${cardId}"] [data-card-open]`)?.focus()
          }
          onCancel={() => {
            setAsk(null);
            refocus.current = null;
          }}
          onMoveAll={() => {
            setAsk(null);
            const [only] = ask.cards;
            // The person went on anyway: the host is told, and keeps a notice on the card.
            if (only && ask.cards.length === 1) runMove(only.id, ask.column, ask.targetId, true);
            else void moveSelected(ask.column, ask.targetId, ask.cards, true);
          }}
          onMoveQualifying={() => {
            setAsk(null);
            const lacks = ask.lacking.map((l) => l.card.id);
            void moveSelected(
              ask.column,
              ask.targetId,
              ask.cards.filter((card) => !lacks.includes(card.id)),
            );
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
      {startAsk.dialog}
      {starting && (
        <CardStartDialog
          store={store}
          hostId={hostId}
          card={starting}
          onClose={() => setStarting(null)}
          onStarted={() =>
            store.success(t("kanban.started", { title: starting.title }), {
              label: t("kanban.openCard"),
              run: () => props.onOpenCard(starting.id),
            })
          }
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
            <AssistField
              binding={{
                controller: store.assistant,
                kind: "card.title",
                fieldHostId: hostId,
                ...(description.trim() ? { context: { description } } : {}),
                openSettings: props.onOpenSettings,
              }}
              value={title}
              onChange={setTitle}
              t={t}
            >
              {(control) => (
                <Input
                  aria-label={t("kanban.titleLabel")}
                  placeholder={t("kanban.titlePlaceholder")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  {...control}
                />
              )}
            </AssistField>
            <AssistField
              binding={{
                controller: store.assistant,
                kind: "card.description",
                fieldHostId: hostId,
                ...(title.trim() ? { context: { title } } : {}),
                openSettings: props.onOpenSettings,
              }}
              value={description}
              onChange={setDescription}
              t={t}
            >
              {(control) => (
                <Textarea
                  aria-label={t("kanban.descriptionLabel")}
                  placeholder={t("kanban.descriptionPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  {...control}
                />
              )}
            </AssistField>
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

/** A column's head: its status icon and name, the count as a pill, and a + that adds a card to it. */
function ColumnHeader(
  props: Readonly<{
    id: BoardColumn;
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
