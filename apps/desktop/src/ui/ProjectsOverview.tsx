import type { CostsSummary } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { Input } from "@/components/ui/input";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { addDays, localDay, usd } from "../lib/costs.ts";
import { hubRows } from "../lib/hub.ts";
import {
  buildProjectCards,
  filterProjectCards,
  type ProjectCard,
  type ProjectSort,
  sortProjectCards,
} from "../lib/project-cards.ts";
import { hasFeature } from "../lib/version.ts";

const SORTS: ProjectSort[] = ["activity", "name", "cost", "attention"];

/** Every project of every host as cards, with search and sort (issue #9). */
export function ProjectsOverview(props: {
  store: AppStore;
  state: AppState;
  onOpen(card: ProjectCard): void;
}) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const [costs, setCosts] = useState<Record<string, CostsSummary | undefined>>({});

  // The projects and their cards come from the palette's load; the week's cost from each host.
  const hostKey = state.hosts.map((h) => `${h.id}:${h.status}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the hosts' set or status changes
  useEffect(() => {
    void store.loadPalette();
    const today = localDay(Date.now());
    const filter = { from: addDays(today, -6), to: today };
    for (const host of state.hosts) {
      if (host.status !== "online" || !hasFeature(host.hostInfo?.features, "costs", false))
        continue;
      void store.hostCommand(host.id, "costs.summary", filter).then((summary) => {
        if (summary) setCosts((all) => ({ ...all, [host.id]: summary }));
      });
    }
  }, [store, hostKey]);

  const cards = useMemo(
    () =>
      buildProjectCards({
        hosts: state.hosts
          .filter((host) => host.status === "online")
          .map((host) => ({
            id: host.id,
            name: host.name,
            projects: state.projects[host.id] ?? [],
          })),
        keyOf: (hostId, project) => store.projectKeyOf(hostId, project),
        rows: hubRows(state),
        cards: Object.entries(state.cards).map(([key, card]) => ({
          hostId: state.hosts.find((h) => key.startsWith(`${h.id}/`))?.id ?? "",
          card,
        })),
        costs,
      }),
    [state, store, costs],
  );
  const shown = sortProjectCards(filterProjectCards(cards, query), sort);

  return (
    <Page
      title={t("projectsOverview.title")}
      subtitle={t("projectsOverview.subtitle")}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            className="w-64"
            aria-label={t("projectsOverview.search")}
            placeholder={t("projectsOverview.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
      {cards.length === 0 && <EmptyState icon={FolderGit2} title={t("states.emptyProjects")} />}
      {cards.length > 0 && shown.length === 0 && (
        <EmptyState title={t("projectsOverview.noMatch")} />
      )}
      <ul
        aria-label={t("projectsOverview.title")}
        className="grid grid-cols-1 gap-3 @md:grid-cols-2 @xl:grid-cols-3"
      >
        {shown.map((card) => (
          <li key={`${card.hostId}/${card.projectId}`} data-project={card.name}>
            <button
              type="button"
              aria-label={t("projectsOverview.open", { name: card.name, host: card.hostName })}
              className="flex h-full w-full flex-col gap-2 rounded-lg border bg-card p-4 text-left hover:bg-accent/40 focus-visible:ring-2"
              onClick={() => props.onOpen(card)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{card.name}</span>
                <span className="text-muted-foreground text-xs">{card.hostName}</span>
              </span>
              <span className="text-muted-foreground text-xs">{card.branch}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span>{t("projectsOverview.live", { n: card.liveSessions })}</span>
                <span>{t("projectsOverview.inProgress", { n: card.inProgress })}</span>
                <span className={card.needsYou > 0 ? "font-medium text-status-needs-you" : ""}>
                  {t("projectsOverview.needsYou", { n: card.needsYou })}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                <span title={card.lastActivity ? store.formatDateTime(card.lastActivity) : ""}>
                  {card.lastActivity
                    ? `${t("projectsOverview.lastActivity")}: ${store.formatWhen(card.lastActivity)}`
                    : t("projectsOverview.noActivity")}
                </span>
                <span title={t("projectsOverview.costWeek")}>
                  {card.costWeekUsd === null ? t("projectsOverview.noCost") : usd(card.costWeekUsd)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
