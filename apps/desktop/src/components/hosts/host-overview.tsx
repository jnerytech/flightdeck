import { useEffect, useMemo } from "react";
import { CardGrid } from "@/components/hub/card-grid";
import { SessionCard, STATE_TONES } from "@/components/hub/session-card";
import { Panel } from "@/components/layout/panel";
import { Inline } from "@/components/layout/stack";
import { ProjectCardTile } from "@/components/projects/project-card-tile";
import { Button } from "@/components/ui/button";
import { useProjectCards } from "@/hooks/use-project-cards";
import type { Key } from "../../i18n/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { hostProjectCards, hostSessionRows } from "../../lib/host-overview.ts";
import {
  groupName,
  type HubRow,
  type HubRowState,
  hubRows,
  sessionLineText,
} from "../../lib/hub.ts";
import type { ProjectCard } from "../../lib/project-cards.ts";

/**
 * What a host page leads with: that host's own sessions (the rows and cards of the Sessions list)
 * and its projects (the cards of the Projects list), each with "See all" and an empty state.
 */
export function HostOverview(props: {
  store: AppStore;
  state: Pick<AppState, "projects" | "cards"> & HubRowState;
  host: { id: string; name: string };
  onOpenSession(row: HubRow): void;
  onOpenProject(card: ProjectCard): void;
  onSeeAllSessions(): void;
  onSeeAllProjects(): void;
  onNewSession(): void;
}) {
  const { store, state, host } = props;
  const { t } = store.i18n;
  useEffect(() => {
    void store.refreshHub();
  }, [store]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows read these parts of the state, not all of it
  const rows = useMemo(
    () => hostSessionRows(hubRows(state), host.id),
    [host.id, state.hosts, state.hub, state.meta, state.externals, state.names, state.background],
  );
  const projects = hostProjectCards(useProjectCards(store, state), host.id);
  return (
    <>
      <Panel
        title={t("hostHome.sessionsTitle", { host: host.name })}
        label={t("hostHome.sessionsTitle", { host: host.name })}
      >
        {rows.length === 0 ? (
          <Inline gap={3}>
            <p className="text-muted-foreground text-sm">{t("hostHome.noSessions")}</p>
            <Button size="sm" onClick={props.onNewSession}>
              {t("hostHome.newSession")}
            </Button>
          </Inline>
        ) : (
          <>
            <CardGrid>
              {rows.map((row) => (
                <SessionCard
                  key={row.key}
                  title={row.title}
                  project={groupName(row.projectKey)}
                  host={row.hostName}
                  stateLabel={t(`hub.stateDots.${row.state}` as Key)}
                  tone={STATE_TONES[row.state]}
                  line={sessionLineText(row.summary, store.now(), t)}
                  costLabel={t("hub.cost", { title: row.title })}
                  persona={row.persona?.name ?? null}
                  onOpen={() => props.onOpenSession(row)}
                />
              ))}
            </CardGrid>
            <div>
              <Button variant="ghost" size="sm" onClick={props.onSeeAllSessions}>
                {t("hostHome.seeAllSessions")}
              </Button>
            </div>
          </>
        )}
      </Panel>
      <Panel
        title={t("hostHome.projectsTitle", { host: host.name })}
        label={t("hostHome.projectsTitle", { host: host.name })}
      >
        {projects.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("hostHome.noProjects")}</p>
        ) : (
          <>
            <ul className="card-grid">
              {projects.map((card) => (
                <ProjectCardTile
                  key={card.projectId}
                  store={store}
                  card={card}
                  onOpen={() => props.onOpenProject(card)}
                />
              ))}
            </ul>
            <div>
              <Button variant="ghost" size="sm" onClick={props.onSeeAllProjects}>
                {t("hostHome.seeAllProjects")}
              </Button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
