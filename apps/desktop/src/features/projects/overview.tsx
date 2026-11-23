import type { Project } from "@flightdeck/protocol";
import { FolderGit2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSwitcherHosts } from "@/features/hosts/index.ts";
import type { HubRowState } from "@/features/sessions/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, LoadingState, NativeSelect, Page } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import {
  filterProjectCards,
  type ProjectCard,
  type ProjectSort,
  sortProjectCards,
} from "./domain/project-cards.ts";
import { NewProject } from "./new-project.tsx";
import { ProjectCardTile } from "./project-card-tile.tsx";
import { ReadFailed } from "./read-failed.tsx";
import { useProjectCardsRead } from "./use-project-cards.ts";

const SORTS: ProjectSort[] = ["activity", "name", "cost", "attention"];

/** Every project of every host as cards, with search and sort (issue #9). */
export function ProjectsOverview(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "projects" | "projectsFailed" | "cards" | "hosts"> &
      Omit<HubRowState, "hosts">;
    onOpen(card: ProjectCard): void;
    /** A project was added from here (issue #931): the screen goes to it. */
    onAdded?(hostId: string, project: Project): void;
    /** Only this host's projects (its id), with a chip that clears the filter. */
    host?: string;
    onClearHost?(): void;
  }>,
) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const { cards, read } = useProjectCardsRead(store, state);
  const hostName = props.host ? state.hosts.find((h) => h.id === props.host)?.name : undefined;
  // A route's host wins; else the hosts the switcher shows (#932), so a pick never lands elsewhere.
  const switcher = useSwitcherHosts(store, state.hosts);
  const shownHosts = new Set(switcher.map((host) => host.id));
  /** The one host the page shows, if one: the route's, else the switcher's. */
  const onlySwitched = switcher.length === 1 ? switcher[0] : undefined;
  const one = props.host ? state.hosts.find((host) => host.id === props.host) : onlySwitched;
  const scoped = props.host
    ? cards.filter((card) => card.hostId === props.host)
    : cards.filter((card) => shownHosts.has(card.hostId));
  const shown = sortProjectCards(filterProjectCards(scoped, query), sort);
  // No cards yet is "no projects" only once the lists were read: before that, or while a shown
  // host still connects, the person is waiting. A host that is offline says so at once (#3922).
  const inView = props.host ? state.hosts.filter((h) => h.id === props.host) : switcher;
  // A host that already answered with no projects settles it: only a view with no host online waits on one connecting.
  const connecting =
    inView.some((host) => host.status === "connecting") &&
    !inView.some((host) => host.status === "online");
  const offline = one !== undefined && one.status !== "online" && one.status !== "connecting";
  const loading = useMinLoading(scoped.length === 0 && (connecting || (!read && !offline)));
  // A host that is online but refused its list has no projects to show: it says so, not "no projects", even when other hosts' cards show (#4397).
  const refused = inView.filter(
    (host) => host.status === "online" && state.projectsFailed[host.id],
  );

  return (
    <Page
      title={t("projectsOverview.title")}
      subtitle={
        one
          ? t("projectsOverview.subtitleHost", { host: one.name })
          : t("projectsOverview.subtitle")
      }
      actions={
        <NewProject
          store={store}
          hosts={props.host ? state.hosts.filter((h) => h.id === props.host) : switcher}
          onAdded={(hostId, project) => props.onAdded?.(hostId, project)}
        />
      }
      toolbar={
        <div className="row-wrap">
          <Input
            type="search"
            className="search-width"
            aria-label={t("projectsOverview.search")}
            placeholder={t("projectsOverview.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {props.host && (
            <Button
              variant="outline"
              size="sm"
              aria-label={t("projectsOverview.clearHost", { host: hostName ?? props.host })}
              onClick={props.onClearHost}
            >
              {hostName ?? props.host}
              <X aria-hidden="true" />
            </Button>
          )}
          <NativeSelect
            inline
            aria-label={t("projectsOverview.sortBy")}
            value={sort}
            onChange={(e) => setSort(e.target.value as ProjectSort)}
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {t(`projectsOverview.sorts.${key}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      }
    >
      {scoped.length === 0 && loading && <LoadingState label={t("states.loadingProjects")} />}
      {!loading && refused.length > 0 && (
        <ReadFailed store={store} onRetry={() => store.palette.load()} />
      )}
      {scoped.length === 0 && !loading && refused.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title={
            one && one.status !== "online"
              ? t("projectsOverview.hostOffline", { host: one.name })
              : t("states.emptyProjects")
          }
        />
      )}
      {scoped.length > 0 && shown.length === 0 && (
        <EmptyState title={t("projectsOverview.noMatch")} />
      )}
      <ul aria-label={t("projectsOverview.title")} className="card-grid">
        {shown.map((card) => (
          <ProjectCardTile
            key={`${card.hostId}/${card.projectId}`}
            store={store}
            card={card}
            onOpen={() => props.onOpen(card)}
          />
        ))}
      </ul>
    </Page>
  );
}
