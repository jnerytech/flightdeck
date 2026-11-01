import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { Columns3, ListTodo, MoreHorizontal, Plus } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
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
import { useStoreSlice } from "@/lib/use-store";
import { AppDialogContent } from "../components/feedback/dialog-content.tsx";
import type { Key } from "../i18n/index.ts";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { COLUMNS, filterCards, positionBefore, projectCards } from "../lib/board.ts";
import { issueNumber } from "../lib/issues.ts";
import { statusTone } from "../lib/status.ts";
import { hasFeature } from "../lib/version.ts";
import { ExternalSeal, IssuesPanel } from "./IssuesPanel.tsx";

function CardTile(props: {
  card: Card;
  /** The name of the workflow the card is running, when known. */
  workflow?: string;
  formatTime(iso: string): string;
  labels: { actions: string; start: string };
  /** The ways to move the card without dragging it, in menu order. */
  moves: Array<{ key: string; label: string; disabled?: boolean; onSelect(): void }>;
  onOpen(): void;
  /** "Iniciar card" from the card's menu, without opening it (phase 10). */
  onStart(): void;
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
            <DropdownMenuItem onSelect={props.onStart}>{props.labels.start}</DropdownMenuItem>
            {props.moves.map((move) => (
              <DropdownMenuItem key={move.key} disabled={move.disabled} onSelect={move.onSelect}>
                {move.label}
              </DropdownMenuItem>
            ))}
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
        {card.issueRef && <Badge variant="outline">{issueNumber(card.issueRef)}</Badge>}
        {card.issueExternal && <ExternalSeal t={t} />}
        {card.prState && <Badge variant="outline">{t(`pr.${card.prState}` as Key)}</Badge>}
        {card.checksState && (
          <Badge variant="outline">{t(`checks.${card.checksState}` as Key)}</Badge>
        )}
      </div>
      {card.notice && <InlineNotice>{card.notice}</InlineNotice>}
    </li>
  );
}

const BOARDVIEW_KEYS = ["runs", "hosts", "cards"] as const;

/** A project's board: five columns, drag and drop between and within them, text filter. */
export const BoardView = memo(function BoardView(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string): void;
}) {
  const { store, hostId, projectId } = props;
  const state = useStoreSlice(store, BOARDVIEW_KEYS);
  const [project, setProject] = useState<Project | null>(null);
  const [filter, setFilter] = useState("");
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
  /** The issues panel (phase 13), on a daemon that announces issues. */
  const [issuesOpen, setIssuesOpen] = useState(false);
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
  const shown = filterCards(all, filter);

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
      title={t("kanban.boardOf", { project: project?.name ?? "" })}
      toolbar={
        <Toolbar label={t("hub.filters")}>
          <Input
            aria-label={t("kanban.filter")}
            placeholder={t("hub.filterPlaceholder")}
            className="h-8 w-40 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {withIssues && (
            <Button size="sm" variant="outline" onClick={() => setIssuesOpen(true)}>
              <ListTodo aria-hidden="true" />
              {t("issuesUi.button")}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("kanban.newCard")}
          </Button>
        </Toolbar>
      }
    >
      <div className="flex flex-col gap-4">
        {loading && <LoadingState label={t("states.loadingBoard")} />}
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
              className="flex min-h-32 flex-col gap-2 rounded-lg bg-secondary/50 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(id)}
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
                      }}
                      moves={movesOf(card)}
                      onOpen={() => props.onOpenCard(card.id)}
                      onStart={() =>
                        void store.hostCommand(hostId, "card.start", { cardId: card.id })
                      }
                      onDragStart={() => {
                        dragging.current = card.id;
                      }}
                      onDropOn={() => drop(id, card.id)}
                    />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
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
