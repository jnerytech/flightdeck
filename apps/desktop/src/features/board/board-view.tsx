import type { BoardColumn, Card, ContractOverrides } from "@flightdeck/protocol";
import { Columns3 } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { BoardNotice } from "@/features/board/board-notice";
import { BoardStatus } from "@/features/board/board-status";
import { ColumnSwitcher } from "@/features/board/column-switcher";
import {
  boardFeatures,
  boardOrder,
  cardMoves,
  columnCards,
  idsByColumn,
  moveLabel,
  refusalNames,
  showingColumn,
  shownCards,
  tabStops,
} from "@/features/board/domain/board-derive";
import { quietBadge } from "@/features/board/quiet-badge-view";
import { SelectionBar, SelectionSlot } from "@/features/board/selection-bar";
import { BoardFilesPanel } from "@/features/files/ui.ts";
import { activeWorktreeFilter, worktreeOfProject } from "@/features/projects/index.ts";
import { WorktreeChip } from "@/features/projects/ui.ts";
import { RoiCard } from "@/features/roi/ui.ts";
import { useStoreSlice } from "@/lib/use-store";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, LoadingState, Page } from "@/shared/layout/index.ts";
import { useWidth } from "@/shared/lib/index.ts";
import type { Key } from "../../i18n/index.ts";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";
import { quietAlerts } from "../needs-you/index.ts";
import { cardKey } from "./board-card-keys.ts";
import { ColumnLane } from "./board-column.tsx";
import { BoardDialogs } from "./board-dialogs.tsx";
import { BoardFilters } from "./board-filters.tsx";
import { BoardLoadError } from "./board-load-error.tsx";
import { CardTile } from "./card-tile.tsx";
import { boardTitle, COLUMNS, positionBefore, projectCards, startOffText } from "./domain/board.ts";
import { bulkSplit } from "./domain/board-bulk.ts";
import { askAbout, dragNeeds } from "./domain/board-contracts.ts";
import { boardFiles, filesPanelOpen } from "./domain/board-files.ts";
import {
  type BulkRefusal,
  COLUMN_GAP,
  columnCount,
  countLabel,
  filteredColumnCount,
  filteredCountLabel,
  fitColumnWidth,
} from "./domain/board-select.ts";
import { cardStartBlock } from "./domain/card-start-block.ts";
import { useBoardProject } from "./use-board-project.ts";
import { useBulkRun } from "./use-bulk-run.tsx";
import { useCardSelection } from "./use-card-selection.ts";
import { type MoveFocus, useMoveFocus } from "./use-move-focus.ts";
import { type MoveAsk, useSelectionActions } from "./use-selection-actions.tsx";
import { useStartAsk } from "./use-start-ask.tsx";

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
  const [ask, setAsk] = useState<MoveAsk | null>(null);
  /** The issues panel (phase 13), on a daemon that announces issues. */
  const [issuesOpen, setIssuesOpen] = useState(false);
  /** #1198: the card the board's Tab stop is on, and the column a narrow board shows. */
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [shownColumn, setShownColumn] = useState<BoardColumn | null>(null);
  /** A card to focus once its column shows; the last key, to leave `g s` to the go-to chord. */
  const pendingFocus = useRef<string | null>(null);
  const lastKey = useRef({ key: "", at: 0 });
  const hintId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  /** #1354: the bar's Move to… menu, opened by its button or by `m` on a card of a selection. */
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
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
  const {
    setPicked,
    anchor,
    rangeBase,
    selection,
    acting,
    actingCards,
    clearSelection,
    select,
    selectRange,
  } = useCardSelection({ all, shown, boardIds, focusBoard: () => boardRef.current?.focus() });
  const nameRefusals = (refused: BulkRefusal[]) => refusalNames(refused, t);
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
  const columnOf = (column: BoardColumn) => columnCards(all, column);
  const selectionActions = useSelectionActions({
    store,
    hostId,
    acting,
    actingCards,
    split,
    contracts,
    columnOf,
    busy,
    setBusy,
    setAsk,
    setPicked,
    setNotice,
    nameRefusals,
    opener: { remember: rememberOpener, restore: restoreOpener },
    boardRef,
  });
  const { moveSelected, updateSelected, updating } = selectionActions;
  /** #1553: the cards whose session says nothing, by session, with the badge's words. */
  const nowMs = store.now();
  const quietBySession = new Map(quietAlerts(state, nowMs, t).map((alert) => [alert.key, alert]));
  const quietOf = (card: Card) => quietBadge(card, hostId, quietBySession, nowMs, t);
  const titlesOf = (ids: string[]) =>
    ids.map((id) => all.find((card) => card.id === id)?.title ?? id).join(", ");

  /** The card to focus once a move has happened: where it was, to tell when it has moved. */
  const refocus = useRef<MoveFocus | null>(null);
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
                  onDiscard={selectionActions.askDiscard}
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
            <BoardFilters
              t={t}
              store={store}
              hostId={hostId}
              projectId={projectId}
              filter={filter}
              onFilter={setFilter}
              withDeps={withDeps}
              onlyBlocked={onlyBlocked}
              onToggleBlocked={() => setOnlyBlocked(!onlyBlocked)}
              withSync={withSync}
              withFiles={Boolean(files)}
              filesShown={filesShown}
              onToggleFiles={() =>
                setFilesChoice({ path: treeBranch?.path ?? "", open: !filesShown })
              }
              withIssues={withIssues}
              onOpenIssues={() => setIssuesOpen(true)}
              onOpenProject={props.onOpenProject}
              onNewCard={() => setCreating(true)}
            />
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
                <ColumnLane
                  key={id}
                  t={t}
                  id={id}
                  hidden={switcher && id !== showing}
                  asking={asking}
                  over={over === id}
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
                  onAdd={() => {
                    setCreateIn(id);
                    setCreating(true);
                  }}
                  onDragEnter={() => setOver(id)}
                  onDragLeave={() => setOver(null)}
                  onDrop={() => {
                    setOver(null);
                    drop(id);
                  }}
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
                </ColumnLane>
              );
            })}
          </div>
          {files && filesShown && <BoardFilesPanel store={store} hostId={hostId} files={files} />}
        </div>
      </div>
      <BoardDialogs
        t={t}
        store={store}
        hostId={hostId}
        projectId={projectId}
        project={project}
        cards={all}
        hookDialogs={
          <>
            {selectionActions.dialog}
            {bulkRun.dialog}
            {startAsk.dialog}
          </>
        }
        deleting={deleting}
        onDeleteClose={() => setDeleting(null)}
        ask={ask}
        onAskClose={() => setAsk(null)}
        refocus={refocus}
        runMove={runMove}
        moveSelected={moveSelected}
        issuesOpen={issuesOpen}
        onIssuesClose={() => setIssuesOpen(false)}
        onProject={setProject}
        starting={starting}
        onStartingClose={() => setStarting(null)}
        creating={creating}
        createIn={createIn}
        onCreatingClose={() => {
          setCreating(false);
          setCreateIn("backlog");
        }}
        cardTemplates={withCardTemplates}
        onOpenCard={props.onOpenCard}
        onOpenSettings={props.onOpenSettings}
      />
    </Page>
  );
});
