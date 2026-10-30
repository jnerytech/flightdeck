import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { Columns3, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { StatusDot } from "@/components/status/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { Key } from "../i18n/index.ts";
import { type AppState, type AppStore, sessionKey } from "../lib/app-store.ts";
import { COLUMNS, filterCards, positionBefore, projectCards } from "../lib/board.ts";
import { statusTone } from "../lib/status.ts";

function CardTile(props: {
  card: Card;
  /** The name of the workflow the card is running, when known. */
  workflow?: string | undefined;
  formatTime(iso: string): string;
  labels: { actions: string; start: string };
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
          <button type="button" className="min-w-0 text-left font-medium" onClick={props.onOpen}>
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
        {card.prState && <Badge variant="outline">{t(`pr.${card.prState}` as Key)}</Badge>}
        {card.checksState && (
          <Badge variant="outline">{t(`checks.${card.checksState}` as Key)}</Badge>
        )}
      </div>
      {card.notice && <InlineNotice>{card.notice}</InlineNotice>}
    </li>
  );
}

/** A project's board: five columns, drag and drop between and within them, text filter. */
export function BoardView(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  projectId: string;
  onOpenCard(cardId: string): void;
}) {
  const { store, hostId, projectId } = props;
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
  const { t } = store.i18n;

  useEffect(() => {
    void store.hostCommand(hostId, "board.get", { projectId }).then((board) => {
      if (board) setProject(board.project);
    });
  }, [store, hostId, projectId]);

  const all = projectCards(props.state, hostId, projectId);
  const shown = filterCards(all, filter);

  const drop = (column: BoardColumn, targetId?: string) => {
    const cardId = dragging.current;
    if (!cardId) return;
    const others = all.filter((card) => card.column === column && card.id !== cardId);
    const position = targetId ? positionBefore(others, targetId) : undefined;
    dragging.current = null;
    void store.hostCommand(hostId, "card.move", {
      cardId,
      column,
      ...(position !== undefined ? { position } : {}),
    });
  };

  const create = () => {
    if (!title.trim()) return;
    void store.hostCommand(hostId, "card.create", { projectId, title: title.trim(), description });
    close();
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
                          ? props.state.runs[sessionKey(hostId, card.workflowRunId)]?.workflowName
                          : undefined
                      }
                      formatTime={(iso) => store.formatTime(iso)}
                      labels={{
                        actions: store.i18n.t("board.cardActions", { title: card.title }),
                        start: store.i18n.t("board.startCard"),
                      }}
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
      <Dialog open={creating} onOpenChange={(open) => (open ? setCreating(true) : close())}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("kanban.newCard")}</DialogTitle>
          </DialogHeader>
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
            <Button variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button onClick={create}>{t("kanban.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
