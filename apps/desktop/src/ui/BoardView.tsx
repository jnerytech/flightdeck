import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { Columns3, ListTodo, Lock, MoreHorizontal, Plus } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { BoardSyncControl } from "@/components/board/board-sync";
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
import { CardStartDialog } from "../components/board/card-start-dialog.tsx";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { Key } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { boardTitle, COLUMNS, filterCards, positionBefore, projectCards } from "../lib/board.ts";
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
  labels: { actions: string; start: string; edit: string; delete: string };
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
  onDropOn(): void;
}) {
  const t = useT();
  const { card } = props;
  /** The workflow (when its run is known) and the branch, when there are any. */
  const meta = [props.workflow, card.branch].filter(Boolean).join(" · ");
  return (
    <li
      draggable
      data-card={card.id}
      aria-label={t("kanban.card", { title: card.title })}
      className="flex cursor-grab flex-col gap-2 rounded-md border bg-card p-2 text-sm hover:bg-accent"
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
            onClick={props.onOpen}
          >
            {card.title}
          </button>
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
const hasStarted = (card: Card) => Boolean(card.worktreePath || card.branch || card.sessionId);

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
  const [starting, setStarting] = useState<Card | null>(null);
  /** The card whose Delete… is asking for confirmation. */
  const [deleting, setDeleting] = useState<Card | null>(null);
  /** The column a dragged card is over. */
  const [over, setOver] = useState<string | null>(null);
  /** The issues panel (phase 13), on a daemon that announces issues. */
  const [issuesOpen, setIssuesOpen] = useState(false);
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
    if (!cardId) return;
    dragging.current = null;
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
    const made = store.hostCommand(hostId, "card.create", {
      projectId,
      title: title.trim(),
      description,
    });
    close();
    void made.then((card) => {
      if (card) {
        store.success(t("kanban.created", { title: card.title }), {
          label: t("kanban.openCard"),
          run: () => props.onOpenCard(card.id),
        });
      }
    });
    return made;
  };
  /** Closes the dialog and forgets what was typed. */
  const close = () => {
    setCreating(false);
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
        <div
          ref={boardRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the columns scroll sideways; focus lets the keyboard do it
          tabIndex={0}
          className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2"
        >
          {COLUMNS.map(({ id }) => (
            <section
              key={id}
              aria-label={t(`kanban.columns.${id}` as Key)}
              className={cn(
                "flex min-h-32 flex-col gap-2 rounded-lg bg-secondary/50 p-2",
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
              <h3 className="px-1 font-medium text-muted-foreground text-xs">
                {t(`kanban.columns.${id}` as Key)}
              </h3>
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
                      }}
                      startOff={
                        card.queued
                          ? store.i18n.t("board.startQueued")
                          : card.sessionStatus &&
                              ["starting", "running", "awaiting_permission"].includes(
                                card.sessionStatus,
                              )
                            ? store.i18n.t("board.startRunning")
                            : null
                      }
                      deps={{
                        waiting: titlesOf(card.waitingOn),
                        holding: titlesOf(card.blocking),
                      }}
                      moves={movesOf(card)}
                      onOpen={() => props.onOpenCard(card.id)}
                      onEdit={() => props.onOpenCard(card.id, true)}
                      onDelete={() => setDeleting(card)}
                      onStart={() => setStarting(card)}
                      onDragStart={() => {
                        dragging.current = card.id;
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
