import { FolderGit2, X } from "lucide-react";
import { useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { ProjectCardTile } from "@/components/projects/project-card-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectCards } from "@/hooks/use-project-cards";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { HubRowState } from "../lib/hub.ts";
import {
  filterProjectCards,
  type ProjectCard,
  type ProjectSort,
  sortProjectCards,
} from "../lib/project-cards.ts";

const SORTS: ProjectSort[] = ["activity", "name", "cost", "attention"];

/** Every project of every host as cards, with search and sort (issue #9). */
export function ProjectsOverview(props: {
  store: AppStore;
  state: Pick<AppState, "projects" | "cards"> & HubRowState;
  onOpen(card: ProjectCard): void;
  /** Only this host's projects (its id), with a chip that clears the filter. */
  host?: string | undefined;
  onClearHost?(): void;
}) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const cards = useProjectCards(store, state);
  const hostName = props.host ? state.hosts.find((h) => h.id === props.host)?.name : undefined;
  const scoped = props.host ? cards.filter((card) => card.hostId === props.host) : cards;
  const shown = sortProjectCards(filterProjectCards(scoped, query), sort);

  return (
    <Page
      title={t("projectsOverview.title")}
      subtitle={t("projectsOverview.subtitle")}
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
      {scoped.length === 0 && <EmptyState icon={FolderGit2} title={t("states.emptyProjects")} />}
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
