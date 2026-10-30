import type { BoardColumn, Card, Project } from "@flightdeck/protocol";
import { Columns3, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Toolbar } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { COLUMNS, filterCards, positionBefore, projectCards } from "../lib/board.ts";
import { StatusBadge } from "./StatusBadge.tsx";

function CardTile(props: {
  card: Card;
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
        <button type="button" className="min-w-0 text-left font-medium" onClick={props.onOpen}>
          {card.title}
        </button>
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
      <div className="flex flex-wrap items-center gap-2">
        {card.sessionStatus && <StatusBadge status={card.sessionStatus} />}
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
  const titleField = useRef<HTMLInputElement>(null);
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
          <Input
            ref={titleField}
            aria-label={t("kanban.titleLabel")}
            placeholder={t("kanban.titlePlaceholder")}
            className="h-8 w-48 text-xs"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            aria-label={t("kanban.descriptionLabel")}
            placeholder={t("kanban.descriptionPlaceholder")}
            className="h-8 min-w-48 flex-1 text-xs"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button size="sm" onClick={create}>
            {t("kanban.create")}
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
            action={
              <Button onClick={() => titleField.current?.focus()}>{t("states.newCard")}</Button>
            }
          />
        )}
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the columns scroll sideways; focus lets the keyboard do it
          tabIndex={0}
          className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2"
        >
          {COLUMNS.map(({ id, label }) => (
            <section
              key={id}
              aria-label={label}
              className="flex min-h-32 flex-col gap-2 rounded-lg bg-secondary/50 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(id)}
            >
              <h3 className="px-1 font-medium text-muted-foreground text-xs">{label}</h3>
              <ul className="flex flex-col gap-2">
                {shown
                  .filter((card) => card.column === id)
                  .map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
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
    </Page>
  );
}
