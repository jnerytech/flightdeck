import type { Project } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { EmptyState } from "@/components/layout/states";
import { Input } from "@/components/ui/input";
import { useProjectCards } from "@/hooks/use-project-cards";
import type { Key } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { COLUMNS } from "../../lib/board.ts";
import { usd } from "../../lib/costs.ts";
import { gridStep } from "../../lib/grid-keys.ts";
import {
  boardLandingOrder,
  buildProjectCards,
  filterProjectCards,
  type ProjectCard,
} from "../../lib/project-cards.ts";
import { useStoreState } from "../../lib/use-store.ts";
import { AddProject } from "./add-project.tsx";

/** Past this many projects the landing offers a filter box. */
const FILTER_FROM = 7;

/** What a screen reader hears between two facts; the eye has the gap. */
function Pause(props: Readonly<{ last?: boolean }>) {
  return <span className="sr-only">{props.last ? ". " : ", "}</span>;
}

/** One project of the landing: a single button that opens its board, described by its counts. */
function BoardCard(props: Readonly<{ store: AppStore; card: ProjectCard; onOpen(): void }>) {
  const { store, card } = props;
  const { t } = store.i18n;
  const factsId = useId();
  const where = `${card.path} · ${card.branch}`;
  const filled = COLUMNS.filter(({ id }) => card.columns[id] > 0);
  return (
    <li>
      <button
        type="button"
        data-slot="board-card"
        aria-label={t("projectsUi.openBoard", { name: card.name })}
        aria-describedby={factsId}
        className="card-button rounded-lg border bg-card text-left hover:bg-accent/40 focus-visible:ring-2"
        onClick={props.onOpen}
      >
        <span className="truncate font-medium">{card.name}</span>
        <span
          data-slot="board-card-path"
          className="truncate text-muted-foreground text-xs"
          title={where}
        >
          {where}
        </span>
        {/* What a screen reader hears after the card's name: the button's label replaces its text. */}
        <span id={factsId} className="flex flex-col gap-2">
          <span data-slot="board-card-columns" className="facts-wrap text-sm">
            {filled.length === 0 ? (
              <span className="text-muted-foreground">{t("boardLanding.noCards")}</span>
            ) : (
              filled.map(({ id }, at) => (
                <span
                  key={id}
                  className={id === "waiting" ? "font-medium text-status-needs-you" : ""}
                >
                  {`${t(`kanban.columns.${id}` as Key)} ${card.columns[id]}`}
                  <Pause last={at === filled.length - 1} />
                </span>
              ))
            )}
            {filled.length === 0 && <Pause last />}
          </span>
          <span className="facts-wrap text-sm">
            <span>
              {t("projectsOverview.live", { n: card.liveSessions })}
              <Pause last={card.needsYou === 0} />
            </span>
            {card.needsYou > 0 && (
              <span className="font-medium text-status-needs-you">
                {t("boardLanding.sessionsNeedYou", { n: card.needsYou })}
                <Pause last />
              </span>
            )}
          </span>
          <span className="row-spread text-muted-foreground text-xs">
            <span title={card.lastActivity ? store.formatDateTime(card.lastActivity) : ""}>
              {card.lastActivity
                ? `${t("projectsOverview.lastActivity")}: ${store.formatWhen(card.lastActivity)}`
                : t("projectsOverview.noActivity")}
            </span>
            <span>{`${t("projectsOverview.costWeek")}: ${
              card.costWeekUsd === null ? t("projectsOverview.noCost") : usd(card.costWeekUsd)
            }`}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** The arrows move the focus between the cards, by where they sit in the grid. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  const cards = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-slot='board-card']"),
  ];
  const from = cards.indexOf(event.target as HTMLButtonElement);
  if (from < 0) return;
  const spots = cards.map((card) => card.getBoundingClientRect());
  const to = gridStep(spots, from, event.key);
  if (to === null) return;
  event.preventDefault();
  cards[to]?.focus();
}

/**
 * The Board screen of a host (#669): its projects as cards, the ones that need you first, then
 * the latest activity. Each card opens its board; a host without a project offers Add project.
 */
export function BoardLanding(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    cards: ProjectCard[];
    onOpenBoard(projectId: string): void;
    onAdded(): void;
  }>,
) {
  const { store, hostId } = props;
  const { t } = store.i18n;
  const [query, setQuery] = useState("");
  if (props.cards.length === 0) {
    return (
      <EmptyState
        icon={FolderGit2}
        title={t("states.emptyProjects")}
        detail={t("boardLanding.whatIs")}
        action={<AddProject store={store} hostId={hostId} onAdded={props.onAdded} />}
      />
    );
  }
  const shown = boardLandingOrder(filterProjectCards(props.cards, query));
  return (
    <>
      <div className="button-row">
        <AddProject store={store} hostId={hostId} variant="outline" onAdded={props.onAdded} />
        {props.cards.length >= FILTER_FROM && (
          <Input
            aria-label={t("boardLanding.filter")}
            placeholder={t("boardLanding.filter")}
            value={query}
            className="max-w-64"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("boardLanding.noMatch")}</p>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the arrows move between the cards' buttons
        <ul aria-label={t("projectsUi.list")} className="card-grid" onKeyDown={moveFocus}>
          {shown.map((card) => (
            <BoardCard
              key={card.projectId}
              store={store}
              card={card}
              onOpen={() => props.onOpenBoard(card.projectId)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The landing on the app's live state: one card for each project the host listed (and the client
 * filter kept), with the counts the app holds; a project the app has not loaded yet shows zeros.
 */
export function HostBoardLanding(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    projects: Project[];
    onOpenBoard(projectId: string): void;
    onAdded(): void;
  }>,
) {
  const { store, hostId, hostName, projects } = props;
  const all = useProjectCards(store, useStoreState(store));
  const cards = useMemo(() => {
    const known = new Map(
      all.filter((card) => card.hostId === hostId).map((card) => [card.projectId, card]),
    );
    const fresh = buildProjectCards({
      hosts: [{ id: hostId, name: hostName, projects }],
      keyOf: (id, project) => store.projectKeyOf(id, project),
      rows: [],
      cards: [],
      costs: {},
    });
    return fresh.map((card) => known.get(card.projectId) ?? card);
  }, [all, hostId, hostName, projects, store]);
  return (
    <BoardLanding
      store={store}
      hostId={hostId}
      cards={cards}
      onOpenBoard={props.onOpenBoard}
      onAdded={props.onAdded}
    />
  );
}
