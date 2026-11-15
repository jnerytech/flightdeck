import type { BoardColumn, Card, ContractOverrides } from "@flightdeck/protocol";
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
  Plus,
} from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardNotice } from "@/features/board/board-notice";
import { BoardStatus } from "@/features/board/board-status";
import { BoardSyncControl } from "@/features/board/board-sync";
import { BulkDiscardDialog, discardCommand } from "@/features/board/bulk-discard-dialog";
import { ColumnHandle } from "@/features/board/column-handle";
import { ColumnSwitcher } from "@/features/board/column-switcher";
import { ContractDialog } from "@/features/board/contract-dialog";
import {
  boardFeatures,
  boardOrder,
  cardMoveBody,
  cardMoves,
  columnCards,
  dropPositions,
  idsByColumn,
  moveLabel,
  refusalNames,
  showingColumn,
  shownCards,
  stayingPicks,
  tabStops,
} from "@/features/board/domain/board-derive";
import { needsText } from "@/features/board/needs-badge";
import { quietBadge } from "@/features/board/quiet-badge-view";
import { SelectionBar, SelectionSlot } from "@/features/board/selection-bar";
import { BoardFilesPanel } from "@/features/files/ui.ts";
import { activeWorktreeFilter, worktreeOfProject } from "@/features/projects/index.ts";
import { AddProject, WorktreeChip } from "@/features/projects/ui.ts";
import { RoiCard } from "@/features/roi/ui.ts";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, Inline, LoadingState, Page, Toolbar } from "@/shared/layout/index.ts";
import { useWidth } from "@/shared/lib/index.ts";
import type { Key } from "../../i18n/index.ts";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";
import { IssuesPanel } from "../issues/ui.ts";
import { quietAlerts } from "../needs-you/index.ts";
import { cardKey } from "./board-card-keys.ts";
import { BoardLoadError } from "./board-load-error.tsx";
import { CardStartDialog } from "./card-start-dialog.tsx";
import { CardTile } from "./card-tile.tsx";
import { BoardColumnEmpty } from "./column-empty.tsx";
import { DeleteCardDialog } from "./delete-card-dialog.tsx";
import { boardTitle, COLUMNS, positionBefore, projectCards, startOffText } from "./domain/board.ts";
import {
  bulkSplit,
  refusalNotice,
  requestResult,
  runMany,
  updateMany,
  updateSummary,
} from "./domain/board-bulk.ts";
import { askAbout, dragNeeds, type Lacking } from "./domain/board-contracts.ts";
import { boardFiles, filesPanelOpen } from "./domain/board-files.ts";
import {
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
} from "./domain/board-select.ts";
import { cardStartBlock } from "./domain/card-start-block.ts";
import { NewCardDialog } from "./new-card-dialog.tsx";
import { useBoardProject } from "./use-board-project.ts";
import { useBulkRun } from "./use-bulk-run.tsx";
import { type MoveFocus, useMoveFocus } from "./use-move-focus.ts";
import { useStartAsk } from "./use-start-ask.tsx";

/** The icon of each column's status, drawn in the column's own tone. */
const COLUMN_ICONS: Record<BoardColumn, LucideIcon> = {
  backlog: Circle,
  in_progress: Loader,
  waiting: CircleAlert,
  review: CircleCheck,
  done: CircleCheckBig,
};

/** How long a card just made is waited for before the focus gives up on it (#1546). */
const MADE_CARD_WAIT_MS = 5000;

const BOARDVIEW_KEYS = [
  "runs",
  "hosts",
  "projects",
  "cards",
  "worktreeFilter",
  "quota",
  "account",
  "personas",
  "budgets",
  "meta",
  "names",
  "quietSnooze",
] as const;

/** A project's board: five columns, drag and drop between and within them, text filter. */
export const BoardView = memo(function BoardView(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string, edit?: boolean): void;
  /** Opens Settings, section Assistant (the wand found no provider). */
  onOpenSettings(): void;
  /** A project was added from here: its board opens. */
  onOpenProject?(projectId: string): void;
  /** The route asks for the New card dialog open as the board shows (#1547). */
  newCard?: boolean;
}) {
  const { store, hostId, projectId } = props;
  const state = useStoreSlice(store, BOARDVIEW_KEYS);
  const { project, setProject, loadFailed, loadBoard } = useBoardProject(store, hostId, projectId);
  const contracts: ContractOverrides = project?.contractByColumn ?? {};
  /** Starting a card with no acceptance criteria asks first (issue #78). */
  const startAsk = useStartAsk({
    restoreFocus: (cardId) =>
      document.querySelector<HTMLElement>(`[data-card="${cardId}"] [data-card-open]`)?.focus(),
  });
  const [filter, setFilter] = useState("");
  /** Phase 31: only the cards that wait for a blocker. */
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  /**
   * Card being dragged. A ref, not state: the drop may come before a re-render. Not in
   * DataTransfer either, which some webviews leave empty.
   */
  const dragging = useRef<string | null>(null);
  const loading = useMinLoading(project === null && !loadFailed);
  /** The new-card dialog. */
  const [creating, setCreating] = useState(props.newCard === true);
  // The ask is used up once the dialog is open, so coming back to this entry shows no dialog (#1582).
  const { newCard } = props;
  useEffect(() => {
    if (newCard !== true) return;
    // Only while the focused tab still shows this ask, so another screen is never replaced.
    const now = store.router.current;
    if (now.name === "board" && now.host === hostId && now.projectId === projectId && now.newCard)
      store.router.replace({ name: "board", host: hostId, projectId });
  }, [newCard, store, hostId, projectId]);
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
  /** #1198: the card the board's Tab stop is on, and the column a narrow board shows. */
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [shownColumn, setShownColumn] = useState<BoardColumn | null>(null);
  /** A card to focus once its column shows; the last key, to leave `g s` to the go-to chord. */
  const pendingFocus = useRef<string | null>(null);
  const lastKey = useRef({ key: "", at: 0 });
  const hintId = useId();
  const anchor = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discardingMany, setDiscardingMany] = useState(false);
  /** #1354: the bar's Move to… menu, opened by its button or by `m` on a card of a selection. */
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  /** A keyboard range (#1354): the selection it started from, so Shift+Up can shrink it back. */
  const rangeBase = useRef<string[] | null>(null);
  /** The card whose `m` opened that menu: the focus goes back to it when the menu closes. */
  const moveFrom = useRef<string | null>(null);
  // A batch of moves or discards is running: nothing else may start.
  const [busy, setBusy] = useState(false);
  /** The cards dragged together when the dragged one is part of a selection. */
  const draggingMany = useRef<string[] | null>(null);
  const chosenWidth = useSyncExternalStore(
    store.boardWidth.subscribe,
    () => store.boardWidth.value,
  );
  const chosen = useSyncExternalStore(store.boardWidth.subscribe, () => store.boardWidth.chosen);
  const {
    deps: withDeps,
    roi: withRoi,
    sync: withSync,
    issues: withIssues,
    memoryPause: withMemoryPause,
    cardTemplates: withCardTemplates,
  } = boardFeatures(state.hosts.find((h) => h.id === hostId)?.hostInfo?.features);
  /** Files pressed for a checkout (#117): another checkout goes back to the default. */
  const [filesChoice, setFilesChoice] = useState<{ path: string; open: boolean } | null>(null);
  /** The board's width: under 900 px the panel would squeeze the columns, so it takes their place. */
  const splitRef = useRef<HTMLDivElement>(null);
  const splitWidth = useWidth(splitRef);
  const narrow = splitWidth > 0 && splitWidth < 900;
  const { t } = store.i18n;

  // The sidebar's Board item opens this board next time on this host (#669).
  useEffect(() => store.viewPrefs.rememberBoard(hostId, projectId), [store, hostId, projectId]);

  const all = projectCards(state, hostId, projectId);
  // The branch picked in the sidebar tree keeps the cards of that checkout (of this project only).
  const active = activeWorktreeFilter(state);
  const treeBranch = worktreeOfProject(active, hostId, projectId);
  const shown = shownCards(all, filter, onlyBlocked, treeBranch);
  const files = boardFiles(
    treeBranch,
    all,
    state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
  );
  // Wide, a picked worktree shows its files at once; narrow, they wait for the Files button.
  const filesShown = filesPanelOpen(files, filesChoice, treeBranch, narrow);
  const filtering = filter.trim() !== "" || onlyBlocked;
  const counts = (inColumn: number, ofColumn: number) =>
    filtering
      ? {
          count: filteredColumnCount(inColumn, ofColumn),
          label: filteredCountLabel(t, inColumn, ofColumn),
        }
      : { count: columnCount(inColumn), label: countLabel(t, inColumn) };
  const boardIds = boardOrder(shown);
  const selection = pruneSelection(
    picked,
    all.map((card) => card.id),
  );
  const acting = shownSelection(selection, boardIds);
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
    const ids = new Set(cards.map((card) => card.id));
    setBusy(true);
    // Dropped on a card, the group lands before it, in the board's order.
    const positions = dropPositions(columnOf(column), cards, targetId);
    const refused = await moveMany(
      cards,
      column,
      async (cardId, to, position) => {
        const answer = await store.hostRequest(
          hostId,
          "card.move",
          cardMoveBody(cardId, to, position, force),
        );
        return requestResult(answer);
      },
      positions,
    );
    const stayed = new Set(refused.map((r) => r.card.id));
    setPicked((before) => stayingPicks(before, ids, stayed));
    setNotice(
      refusalNotice(t, refused, nameRefusals(refused), {
        one: "board.stayedOne",
        many: "board.stayed",
      }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  const nameRefusals = (refused: BulkRefusal[]) => refusalNames(refused, t);
  /** Discards the started cards and deletes the others, one after the other. */
  const discardSelected = async () => {
    if (busy) return;
    const cards = actingCards;
    setDiscardingMany(false);
    setBusy(true);
    const failed = await runMany(cards, async (card) =>
      requestResult(
        await store.hostRequest(hostId, discardCommand(card), { cardId: card.id, confirm: true }),
      ),
    );
    // A discard is not atomic on the host: a card it refused may be partly cleaned up, so it is
    // not left selected for a second try that would fail on what is already gone.
    setPicked((before) => before.filter((id) => !acting.includes(id)));
    setNotice(
      refusalNotice(t, failed, nameRefusals(failed), {
        one: "board.discardFailedOne",
        many: "board.discardFailed",
      }),
    );
    setBusy(false);
    boardRef.current?.focus();
  };
  /** #1354: what Start N and Stop N take from the selection. */
  const split = bulkSplit(actingCards, t);
  /**
   * #1426: what had the focus when a selection's confirm opened (a card, the bar's button). Closing
   * the confirm puts it back there, or on the board when it is gone.
   */
  // After a move the card is somewhere else, so its old element is gone: focus the new one.
  const boardRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const rememberOpener = () => {
    const el = document.activeElement;
    // Nothing focused is the body, which takes no focus: the board is the fallback then.
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
  };
  const restoreOpener = () => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
    else boardRef.current?.focus();
  };
  /** #1406: runs of Update from the base that finished; each puts the focus back after its render. */
  const [updated, setUpdated] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a finished run is the only trigger
  useEffect(() => {
    if (updated > 0) restoreOpener();
  }, [updated]);
  /** #1406: the run of Update from the base, card by card: how far it got. */
  const [updating, setUpdating] = useState<{ done: number; total: number } | null>(null);
  /**
   * #1406: updates the selection's idle cards with a branch from their base, one at a time. A card
   * already on its base is not rebased; a conflicted or refused one stays selected, named.
   */
  const updateSelected = async () => {
    if (busy || split.update.length === 0) return;
    const cards = split.update;
    rememberOpener();
    setBusy(true);
    setNotice(null);
    setUpdating({ done: 0, total: cards.length });
    const results = await updateMany(cards, {
      behind: async (card) => {
        const answer = await store.hostRequest(hostId, "changes.get", {
          target: `card:${card.id}`,
        });
        return answer.ok ? (answer.data.position?.behind ?? null) : null;
      },
      update: async (card) => {
        const answer = await store.hostRequest(hostId, "card.updateFromBase", {
          cardId: card.id,
        });
        return requestResult(answer);
      },
      onProgress: (done, total) => setUpdating({ done, total }),
    });
    const went = new Set(
      results
        .filter((r) => r.outcome === "updated" || r.outcome === "current")
        .map((r) => r.card.id),
    );
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(updateSummary(t, results));
    setUpdating(null);
    setBusy(false);
    // The button was disabled while it ran, and a browser takes the focus off a disabled button:
    // it goes back once the render has turned the button on again.
    setUpdated((n) => n + 1);
  };
  const bulkRun = useBulkRun({
    store,
    hostId,
    projectId,
    project,
    all,
    actingCards,
    split,
    contracts,
    busy,
    setBusy,
    setPicked,
    setNotice,
    memoryPause: withMemoryPause,
    nameRefusals,
    opener: { remember: rememberOpener, restore: restoreOpener },
    boardRef,
  });
  /** Clears the selection and keeps the focus on the board: the bar that had it goes away. */
  const clearSelection = () => {
    anchor.current = null;
    rangeBase.current = null;
    setPicked([]);
    boardRef.current?.focus();
  };
  const select = (card: Card) => {
    rangeBase.current = null;
    // Only a card just selected anchors the next Shift-click.
    if (!selection.includes(card.id)) anchor.current = card.id;
    else if (anchor.current === card.id) anchor.current = null;
    setPicked(toggleSelection(selection, card.id));
  };
  const selectRange = (card: Card) => {
    rangeBase.current = null;
    const order = shown.filter((other) => other.column === card.column).map((other) => other.id);
    setPicked(rangeSelection(order, anchor.current, card.id, selection));
    anchor.current = card.id;
  };
  /** #1553: the cards whose session says nothing, by session, with the badge's words. */
  const nowMs = store.now();
  const quietBySession = new Map(quietAlerts(state, nowMs, t).map((alert) => [alert.key, alert]));
  const quietOf = (card: Card) => quietBadge(card, hostId, quietBySession, nowMs, t);
  const titlesOf = (ids: string[]) =>
    ids.map((id) => all.find((card) => card.id === id)?.title ?? id).join(", ");

  /** The card to focus once a move has happened: where it was, to tell when it has moved. */
  const refocus = useRef<MoveFocus | null>(null);
  const columnOf = (column: BoardColumn) => columnCards(all, column);
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
    const { index, moves } = cardMoves(columnOf(card.column), card);
    return moves.map(({ key, column, targetId, disabled }) => ({
      key,
      label: moveLabel(t, key),
      ...(disabled !== undefined ? { disabled } : {}),
      onSelect: () => {
        refocus.current = { cardId: card.id, column: card.column, index };
        move(card.id, column, targetId);
      },
    }));
  };
  // Until the person picks a width, the columns share what the window gives them (#1030).
  const boardPx = useWidth(boardRef);
  const width = chosen ? chosenWidth : fitColumnWidth(boardPx, COLUMNS.length, COLUMN_GAP);
  // #1198: under 40rem (the board's own snap breakpoint) a narrow board shows one column at a time.
  const switcher = boardPx > 0 && boardPx < 640;
  const shownIds = idsByColumn(shown);
  const showing: BoardColumn = showingColumn(shownColumn, shownIds);
  /**
   * Each column's one Tab stop: the card last focused when it is there, else its first card. One
   * per column, not per board: each column's list scrolls, and axe asks a scrolling region to hold
   * something the keyboard reaches (scrollable-region-focusable).
   */
  const stops = tabStops(shownIds, focusedCard);
  const titleOf = (cardId: string) =>
    boardRef.current?.querySelector<HTMLElement>(`li[data-card="${cardId}"] [data-card-open]`);
  /** Focuses a card, showing its column first on a narrow board. */
  const focusCard = (cardId: string) => {
    const column = all.find((card) => card.id === cardId)?.column;
    if (switcher && column && column !== showing) {
      pendingFocus.current = cardId;
      setShownColumn(column);
      return;
    }
    titleOf(cardId)?.focus();
  };
  useEffect(() => {
    const cardId = pendingFocus.current;
    if (cardId === null) return;
    pendingFocus.current = null;
    titleOf(cardId)?.focus();
  });
  /** A key on a card's title (see `cardKey`): the action comes back for what is the board's own. */
  const keyOn = (cardId: string) => (e: KeyboardEvent<HTMLButtonElement>) =>
    cardKey(
      {
        lastKey,
        rangeBase,
        anchor,
        shownIds,
        boardOrder: boardIds,
        selection,
        cards: all,
        focusCard,
        select,
        setPicked,
      },
      cardId,
      e,
    );
  useMoveFocus(refocus, {
    cards: all,
    columnOf,
    board: boardRef,
    narrow: switcher,
    showing,
    onShow: setShownColumn,
  });

  const selectedSaid =
    acting.length === 1 ? t("board.selectedOne") : t("board.selectedCount", { n: acting.length });
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
                  onDiscard={() => {
                    rememberOpener();
                    setDiscardingMany(true);
                  }}
                  onClear={clearSelection}
                  busy={busy}
                  onEscape={clearSelection}
                  moveOpen={moveMenuOpen}
                  onMoveOpenChange={setMoveMenuOpen}
                  startCount={split.start.length}
                  stopCount={split.stop.length}
                  onStart={bulkRun.askStart}
                  onStop={bulkRun.askStop}
                  updateCount={split.update.length}
                  onUpdate={() => void updateSelected()}
                  updating={updating}
                  otherColumns={
                    switcher ? actingCards.filter((card) => card.column !== showing).length : 0
                  }
                  compact={boardPx > 0 && boardPx < 480}
                  onMoveClosed={() => {
                    const from = moveFrom.current;
                    moveFrom.current = null;
                    const title = from ? titleOf(from) : null;
                    // A card a move took to a column not shown has no title to focus: the button keeps it.
                    if (!title?.isConnected || title.closest("[hidden]")) return false;
                    title.focus();
                    return true;
                  }}
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
        {!loading && !project && loadFailed && (
          <BoardLoadError t={t} onRetry={() => void loadBoard()} />
        )}
        {!loading && project && all.length === 0 && (
          <EmptyState
            icon={Columns3}
            title={t("states.emptyCards")}
            action={<Button onClick={() => setCreating(true)}>{t("states.newCard")}</Button>}
          />
        )}
        <BoardStatus
          text={[selection.length === 0 ? "" : selectedSaid, notice ?? ""]
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
        <p id={hintId} className="sr-only">
          {t("board.keysHint")}
        </p>
        {switcher && all.length > 0 && (
          <ColumnSwitcher
            label={t("board.columns")}
            shown={showing}
            onShow={setShownColumn}
            columns={COLUMNS.map(({ id }, i) => {
              const title = t(`kanban.columns.${id}` as Key);
              const count = shownIds[i]?.length ?? 0;
              return {
                id,
                title,
                count,
                name: t("board.showColumn", { column: title, count: countLabel(t, count) }),
              };
            })}
          />
        )}
        <div ref={splitRef} className="board-split" data-narrow={narrow || undefined}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc clears the selection from any card inside the board */}
          <div // NOSONAR: Esc clears the selection from any card inside the board; the columns are a region, not a control
            ref={boardRef}
            data-slot="board-columns"
            hidden={narrow && filesShown}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the columns scroll sideways; focus lets the keyboard do it
            tabIndex={0} // NOSONAR: a region that scrolls must take focus, or the keyboard cannot scroll it (axe scrollable-region-focusable)
            style={{ gridAutoColumns: switcher ? "minmax(0, 1fr)" : `${width}px` }}
            className="grid min-h-48 flex-1 grid-flow-col gap-3 overflow-x-auto pb-2 @max-[40rem]:snap-x @max-[40rem]:snap-mandatory"
            onKeyDown={(e) => {
              // Only the board's own Esc: one that closes a card's menu is the menu's.
              if (e.key !== "Escape" || e.defaultPrevented) return;
              if (!e.currentTarget.contains(e.target as Node)) return;
              if (selection.length === 0) return;
              // It cleared something: the Esc stops here, so a split view stays open (#1354).
              e.stopPropagation();
              clearSelection();
            }}
          >
            {COLUMNS.map(({ id }) => {
              /** What the dragged cards would lack here: said by the column until they let go. */
              const asking = dragNeeds(id, dragCards, contracts);
              return (
                <section
                  key={id}
                  hidden={switcher && id !== showing}
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
                          quiet={quietOf(card)}
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
                            selectNamed: t("board.selectCardNamed", { title: card.title }),
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
                          selecting={selection.length > 0}
                          onStartSelection={bulkRun.askStart}
                          onMoveSelection={() => {
                            moveFrom.current = card.id;
                            setMoveMenuOpen(true);
                          }}
                          onToggleSelect={() => select(card)}
                          onRangeSelect={() => selectRange(card)}
                          tabbable={stops.has(card.id)}
                          hintId={hintId}
                          onFocus={() => setFocusedCard(card.id)}
                          onKey={keyOn(card.id)}
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
                  {!switcher && (
                    <ColumnHandle
                      t={t}
                      width={width}
                      index={COLUMNS.findIndex((column) => column.id === id) + 1}
                      last={id === COLUMNS.at(-1)?.id}
                      onChange={(next) => store.boardWidth.set(next, false)}
                      onCommit={() => store.boardWidth.persist()}
                    />
                  )}
                </section>
              );
            })}
          </div>
          {files && filesShown && <BoardFilesPanel store={store} hostId={hostId} files={files} />}
        </div>
      </div>
      {deleting && (
        <DeleteCardDialog
          t={t}
          store={store}
          hostId={hostId}
          card={deleting}
          onClose={() => setDeleting(null)}
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
            const lacks = new Set(ask.lacking.map((l) => l.card.id));
            void moveSelected(
              ask.column,
              ask.targetId,
              ask.cards.filter((card) => !lacks.has(card.id)),
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
          onRestoreFocus={restoreOpener}
        />
      )}
      {bulkRun.dialog}
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
      <NewCardDialog
        t={t}
        store={store}
        hostId={hostId}
        projectId={projectId}
        open={creating}
        column={createIn}
        cardTemplates={withCardTemplates}
        onClose={() => {
          setCreating(false);
          setCreateIn("backlog");
        }}
        onOpenCard={props.onOpenCard}
        onMade={(card) => {
          // The card is not on the board yet: the focus waits for it (index -1 is never where it is).
          refocus.current = {
            cardId: card.id,
            column: card.column,
            index: -1,
            until: Date.now() + MADE_CARD_WAIT_MS,
          };
        }}
        onOpenSettings={props.onOpenSettings}
      />
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
