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
import {
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BoardNotice } from "@/components/board/board-notice";
import { BoardStatus } from "@/components/board/board-status";
import { BoardSyncControl } from "@/components/board/board-sync";
import { BulkDiscardDialog, discardCommand } from "@/components/board/bulk-discard-dialog";
import { ColumnHandle } from "@/components/board/column-handle";
import { ColumnSwitcher } from "@/components/board/column-switcher";
import { ContractDialog } from "@/components/board/contract-dialog";
import { NeedsBadge, needsText } from "@/components/board/needs-badge";
import { QuietBadge } from "@/components/board/quiet-badge";
import { RadarBadge } from "@/components/board/radar-badge";
import { SelectionBar, SelectionSlot } from "@/components/board/selection-bar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSuggestedPersona } from "@/features/personas/index.ts";
import { useMinLoading } from "@/hooks/use-min-loading";
import { type MoveFocus, useMoveFocus } from "@/hooks/use-move-focus";
import { useStartAsk } from "@/hooks/use-start-ask";
import { useStartElsewhere } from "@/hooks/use-start-elsewhere";
import { useT } from "@/i18n/context";
import { reasonText } from "@/lib/notice-text";
import { useStoreSlice } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { BulkRunDialog } from "../components/board/bulk-run-dialog.tsx";
import { CardStartDialog } from "../components/board/card-start-dialog.tsx";
import { startPersonaOf, startWorkflowOf } from "../components/board/card-template-field.tsx";
import { DeleteCardDialog } from "../components/board/delete-card-dialog.tsx";
import { NewCardDialog } from "../components/board/new-card-dialog.tsx";
import { formatDuration } from "../i18n/format.ts";
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
import {
  bulkRunOutcome,
  bulkSkipReason,
  bulkSplit,
  bulkTitle,
  holdLines,
  refusalNotice,
  requestResult,
  runMany,
  startConfirmLines,
  startOffers,
  startQuotaLines,
  updateMany,
  updateSummary,
} from "../lib/board-bulk.ts";
import { cardKey } from "../lib/board-card-keys.ts";
import { askAbout, dragNeeds, type Lacking, missingFor } from "../lib/board-contracts.ts";
import { boardFiles, filesPanelOpen } from "../lib/board-files.ts";
import type { BoardKeyAction } from "../lib/board-keys.ts";
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
} from "../lib/board-select.ts";
import { cardStartBlock } from "../lib/card-start-block.ts";
import { radarBadge } from "../lib/conflict-radar.ts";
import { issueNumber } from "../lib/issues.ts";
import { activeWorktreeFilter, cardInFilter, worktreeOfProject } from "../lib/project-tree.ts";
import { quietAlerts, quietText } from "../lib/quiet.ts";
import { elsewhereNotice, waitingCards } from "../lib/start-elsewhere.ts";
import { statusTone } from "../lib/status.ts";
import { useWidth } from "../lib/use-width.ts";
import { hasFeature } from "../lib/version.ts";
import { BoardColumnEmpty } from "./BoardColumnEmpty.tsx";
import { BoardFilesPanel } from "./BoardFiles.tsx";
import { ExternalSeal, IssuesPanel } from "./IssuesPanel.tsx";

/** The icon of each column's status, drawn in the column's own tone. */
const COLUMN_ICONS: Record<BoardColumn, LucideIcon> = {
  backlog: Circle,
  in_progress: Loader,
  waiting: CircleAlert,
  review: CircleCheck,
  done: CircleCheckBig,
};

/** What a card's own text lacks: fixed in its fields, not on the card's run (#1197). */
const FIELD_NEEDS: ReadonlySet<string> = new Set(["criteria", "validation", "spec"]);

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
        {card.queued && !["quota", "memory", "paused"].includes(card.queueReason ?? "") && (
          <Badge variant="outline">{t("kanban.queued")}</Badge>
        )}
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
  /**
   * Card being dragged. A ref, not state: the drop may come before a re-render. Not in
   * DataTransfer either, which some webviews leave empty.
   */
  const dragging = useRef<string | null>(null);
  const loading = useMinLoading(project === null);
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
  /** #1354: the Start N or Stop N confirm, and the host's limit of runs at once (null: not known). */
  const [bulk, setBulk] = useState<"start" | "stop" | null>(null);
  const [queueMax, setQueueMax] = useState<number | null | undefined>(undefined);
  /** The project's workflows (their inputs), asked when Start N's confirm opens; null until then. */
  const [workflows, setWorkflows] = useState<Array<{ name: string; inputs: string[] }> | null>(
    null,
  );
  const [workflowsFailed, setWorkflowsFailed] = useState(false);
  /** #1414: the host's memory was at or over its hold when the confirm opened. */
  const [memoryOver, setMemoryOver] = useState(false);
  /** Which open of Start N's confirm the host's replies belong to. */
  const startAsked = useRef(0);
  const suggestedPersona = useSuggestedPersona(store, hostId, "dev");
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
  /** #1422: the other hosts a Start that would wait can go to. */
  const elsewhere = useStartElsewhere({
    store,
    hostId,
    sourceKey: project ? store.projectKeyOf(hostId, project) : null,
    hosts: state.hosts,
    cards: state.cards,
    t,
  });

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
  const treeBranch = worktreeOfProject(active, hostId, projectId);
  const shown = filterCards(all, filter)
    .filter((card) => !onlyBlocked || card.waitingOn.length > 0)
    .filter((card) => !treeBranch || cardInFilter(card, treeBranch));
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
    const ids = new Set(cards.map((card) => card.id));
    setBusy(true);
    // Dropped on a card, the group lands before it, in the board's order.
    const positions =
      targetId && !ids.has(targetId)
        ? positionsBefore(
            columnOf(column).filter((card) => !ids.has(card.id)),
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
        return requestResult(answer);
      },
      positions,
    );
    const stayed = new Set(refused.map((r) => r.card.id));
    setPicked((before) => before.filter((id) => stayed.has(id) || !ids.has(id)));
    setNotice(
      refusalNotice(t, refused, nameRefusals(refused), {
        one: "board.stayedOne",
        many: "board.stayed",
      }),
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
  /** Opens Start N's confirm, and asks the host its limit and the project's workflows for it. */
  const askStart = () => {
    if (busy || split.start.length === 0) return;
    rememberOpener();
    // Each open asks again; a reply to an earlier open is dropped (#1390's review).
    const asked = ++startAsked.current;
    setQueueMax(undefined);
    setWorkflows(null);
    setWorkflowsFailed(false);
    setMemoryOver(false);
    setBulk("start");
    elsewhere.load();
    // Start waits for both (the confirm's button is off): the queue line and each card's workflow.
    void store.hostCommand(hostId, "project.list", {}).then((list) => {
      if (asked !== startAsked.current) return;
      setQueueMax(typeof list?.maxParallelRuns === "number" ? list.maxParallelRuns : null);
    });
    // The memory hold, read now: with nothing queued yet no card carries its reason (#1414). It
    // fails open: a host that does not answer gets no line, and Start does not wait for it.
    const features = state.hosts.find((h) => h.id === hostId)?.hostInfo?.features;
    if (hasFeature(features, "memoryPause", false)) {
      // The host's own verdict (#1418's review): the share alone is wrong a margin under the hold,
      // and on a host with no reading (macOS). An older host that does not say gets no line.
      void store
        .hostRequest(hostId, "resources.get", {})
        .then((answer) => {
          if (asked !== startAsked.current || !answer.ok) return;
          setMemoryOver(answer.data.memoryHolding === true);
        })
        .catch(() => {});
    }
    void store.hostCommand(hostId, "workflow.list", { projectId }).then((result) => {
      if (asked !== startAsked.current) return;
      // A read that failed is not an empty list: Start stays off and the confirm says why.
      if (!result) {
        setWorkflowsFailed(true);
        return;
      }
      // As the start dialog does: only a trusted workflow with no errors goes with a card.
      setWorkflows(
        (result?.workflows ?? [])
          .filter((w) => w.trusted && w.errors.length === 0)
          .map((w) => ({ name: w.name, inputs: w.inputs })),
      );
    });
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
  const askStop = () => {
    if (busy || split.stop.length === 0) return;
    rememberOpener();
    setBulk("stop");
  };
  /** A card whose workflow asks for inputs starts from its own dialog, where they are typed. */
  const workflowOf = (card: Card) =>
    startWorkflowOf(
      card,
      (workflows ?? []).map((w) => w.name),
    );
  const needsInputs = (card: Card) =>
    (workflows?.find((w) => w.name === workflowOf(card))?.inputs.length ?? 0) > 0;
  const startable = split.start.filter((card) => !needsInputs(card));
  const startReady = queueMax !== undefined && workflows !== null;
  /** The host's cards holding a run: the queue's places they take. */
  const runningOnHost = Object.entries(state.cards).filter(
    ([key, card]) => key.startsWith(`${hostId}/`) && cardStartBlock(card) === "running",
  ).length;
  /** Starts or stops the cards one at a time; the ones that went leave the selection. */
  const runSelected = async (kind: "start" | "stop") => {
    if (busy) return;
    const cards = kind === "start" ? startable : split.stop;
    setBulk(null);
    setBusy(true);
    const personaIds = (state.personas[hostId] ?? []).map((p) => p.id);
    const refused = await runMany(cards, async (card) => {
      const workflow = workflowOf(card);
      const persona = store.personas.ref(startPersonaOf(card, personaIds) ?? suggestedPersona);
      const answer =
        kind === "start"
          ? await store.hostRequest(hostId, "card.start", {
              cardId: card.id,
              ...(workflow ? { workflow, inputs: {} } : {}),
              ...(persona ? { persona } : {}),
            })
          : await store.hostRequest(hostId, "card.stop", { cardId: card.id });
      return requestResult(answer);
    });
    const stayed = new Set(refused.map((r) => r.card.id));
    const went = new Set(cards.map((card) => card.id).filter((id) => !stayed.has(id)));
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(bulkRunOutcome(t, kind, refused, nameRefusals(refused)));
    setBusy(false);
    boardRef.current?.focus();
  };
  const hostName = state.hosts.find((h) => h.id === hostId)?.name ?? hostId;
  /**
   * The host's quota lines, and every hold that keeps new cards waiting (the quota's pause limit, a
   * budget, the host's memory). A hold keeps every new card waiting, so the queue line then says they
   * all join the queue, never "N start now" (#1414).
   */
  const quota = startQuotaLines(t, hostName, {
    quota: state.quota[hostId],
    account: state.account[hostId],
    now: Date.now(),
    formatTime: (iso) => store.formatTime(iso),
  });
  const quotaLines = quota.lines;
  const holds = [...quota.holds];
  holds.push(
    ...holdLines(t, hostName, {
      budgets: state.budgets[hostId] ?? [],
      projectKey: project ? store.projectKeyOf(hostId, project) : null,
      cards: all,
      memoryOver,
      // #1481: a paused host is a hold like the others: the confirm names it and the cards join the queue.
      paused: state.hosts.find((h) => h.id === hostId)?.hostInfo?.pause?.paused === true,
    }),
  );
  /** #1422: the startable cards that would wait here, and the hosts they could start on. */
  const waiting = waitingCards(startable, {
    held: holds.length > 0,
    max: queueMax ?? null,
    running: runningOnHost,
  });
  const otherHosts = startOffers(bulk, startReady, () => elsewhere.offers(waiting));
  /** Hands the cards that would wait to another host: made and started there, then Done here. */
  const startOnOther = async (hostIdOther: string) => {
    const target = otherHosts.find((o) => o.hostId === hostIdOther);
    if (busy || !target) return;
    setBulk(null);
    setBusy(true);
    const outcome = await elsewhere.run(target, waiting);
    const went = new Set(outcome.moved.map((m) => m.card.id));
    setPicked((before) => before.filter((id) => !went.has(id)));
    setNotice(elsewhereNotice(t, outcome, target.name, nameRefusals));
    setBusy(false);
    boardRef.current?.focus();
  };
  /** The confirm's lines: the host's queue, quota and holds for Start, where the cards land for Stop. */
  const bulkLines = (): string[] =>
    bulk === "stop"
      ? [t("board.stopBody")]
      : startConfirmLines(t, {
          workflowsFailed,
          queueMax,
          startable,
          runningOnHost,
          quotaLines,
          holds,
          waitingElsewhere: otherHosts.length > 0 ? waiting.length : 0,
          contracts,
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
  const quietOf = (card: Card) => {
    const alert = card.sessionId
      ? quietBySession.get(sessionKey(hostId, card.sessionId))
      : undefined;
    if (!alert) return null;
    const span = formatDuration(Math.max(0, nowMs - Date.parse(alert.since)), t);
    return { short: t("activityBoard.quiet", { span }), full: quietText(alert, nowMs, t) };
  };
  const titlesOf = (ids: string[]) =>
    ids.map((id) => all.find((card) => card.id === id)?.title ?? id).join(", ");

  /** The card to focus once a move has happened: where it was, to tell when it has moved. */
  const refocus = useRef<MoveFocus | null>(null);
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
  // #1198: under 40rem (the board's own snap breakpoint) a narrow board shows one column at a time.
  const switcher = boardPx > 0 && boardPx < 640;
  const shownIds = COLUMNS.map(({ id }) =>
    shown.filter((card) => card.column === id).map((card) => card.id),
  );
  const showing: BoardColumn =
    shownColumn ?? COLUMNS.find((_, i) => (shownIds[i]?.length ?? 0) > 0)?.id ?? "backlog";
  /**
   * Each column's one Tab stop: the card last focused when it is there, else its first card. One
   * per column, not per board: each column's list scrolls, and axe asks a scrolling region to hold
   * something the keyboard reaches (scrollable-region-focusable).
   */
  const stops = new Set(
    shownIds.map((ids) =>
      focusedCard !== null && ids.includes(focusedCard) ? focusedCard : ids[0],
    ),
  );
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
        boardOrder,
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
                  onStart={askStart}
                  onStop={askStop}
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
                          onStartSelection={askStart}
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
      {bulk && (
        <BulkRunDialog
          t={t}
          title={bulkTitle(t, bulk, { start: startable.length, stop: split.stop.length })}
          lines={bulkLines()}
          items={actingCards.map((card) => {
            const skip = bulkSkipReason(t, bulk, split, card, needsInputs(card));
            return { id: card.id, title: card.title, ...(skip ? { skipped: skip } : {}) };
          })}
          confirmLabel={
            bulk === "start"
              ? t("board.startSelected", { n: startable.length })
              : t("board.stopSelected", { n: split.stop.length })
          }
          confirmDisabled={bulk === "start" && (!startReady || startable.length === 0)}
          alternatives={otherHosts.map((o) => ({
            id: o.hostId,
            label: t("board.startOn", { host: o.name }),
          }))}
          onAlternative={(id) => void startOnOther(id)}
          onCancel={() => setBulk(null)}
          onConfirm={() => void runSelected(bulk)}
          onRestoreFocus={restoreOpener}
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
      <NewCardDialog
        t={t}
        store={store}
        hostId={hostId}
        projectId={projectId}
        open={creating}
        column={createIn}
        cardTemplates={hasFeature(
          state.hosts.find((h) => h.id === hostId)?.hostInfo?.features,
          "cardTemplates",
          false,
        )}
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
