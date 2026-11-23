import { useEffect, useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { type ProjectCard, useProjectCards } from "@/features/projects/index.ts";
import { ProjectCardTile } from "@/features/projects/ui.ts";
import {
  groupName,
  type HubRow,
  type HubRowState,
  hubRows,
  sessionLineText,
} from "@/features/sessions/index.ts";
import { ActionButton } from "@/shared/feedback/index.ts";
import { CardGrid, Inline, Panel, Stack } from "@/shared/layout/index.ts";
import type { Key } from "../../i18n/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { SessionCard, STATE_TONES } from "../sessions/ui.ts";
import { hostDownReason } from "./domain/host-down-reason.ts";
import { hostProjectCards, hostSessionRows } from "./domain/host-overview-model.ts";

/**
 * What a host page leads with: that host's own sessions (the rows and cards of the Sessions list)
 * and its projects (the cards of the Projects list), each with "See all" and an empty state.
 */
export function HostOverview(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "projects" | "cards" | "hosts"> & Omit<HubRowState, "hosts">;
    host: { id: string; name: string; status: string };
    onOpenSession(row: HubRow): void;
    onOpenProject(card: ProjectCard): void;
    onSeeAllSessions(): void;
    onSeeAllProjects(): void;
    onNewSession(): void;
    onAddProject(): void;
  }>,
) {
  const { store, state, host } = props;
  const { t } = store.i18n;
  // A host that does not answer cannot say it has no sessions, nor start one (issue #3786).
  const away = host.status !== "online";
  useEffect(() => {
    void store.sessionLists.refresh();
  }, [store]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows read these parts of the state, not all of it
  const rows = useMemo(
    () => hostSessionRows(hubRows(state, t), host.id),
    [
      host.id,
      state.hosts,
      state.hub,
      state.meta,
      state.externals,
      state.names,
      state.background,
      state.personas,
      t,
    ],
  );
  const reasonId = useId();
  const projects = hostProjectCards(useProjectCards(store, state), host.id);
  return (
    <>
      <Panel
        title={t("hostHome.sessionsTitle", { host: host.name })}
        label={t("hostHome.sessionsTitle", { host: host.name })}
      >
        {rows.length === 0 ? (
          <Stack gap={2}>
            <p className="text-muted-foreground text-sm">
              {away ? t("hostHome.noSessionsAway", { host: host.name }) : t("hostHome.noSessions")}
            </p>
            {/* The reason is a line of the panel, not ActionButton's box hung off the button: in this
                column that box ran past the card and the window (#3862). */}
            <Inline gap={3}>
              <ActionButton
                size="sm"
                disabled={away}
                aria-describedby={away ? reasonId : undefined}
                onClick={props.onNewSession}
              >
                {t("hostHome.newSession")}
              </ActionButton>
              {away && (
                <p id={reasonId} className="text-muted-foreground text-xs">
                  {hostDownReason(host.status, host.name, t)}
                </p>
              )}
            </Inline>
          </Stack>
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
          <Stack gap={2}>
            <p className="text-muted-foreground text-sm">
              {away ? t("hostHome.noProjectsAway", { host: host.name }) : t("hostHome.noProjects")}
            </p>
            {/* The first step after pairing: the host cannot take a project while it does not answer. */}
            {!away && (
              <div>
                <Button size="sm" onClick={props.onAddProject}>
                  {t("hostHome.addProject")}
                </Button>
              </div>
            )}
          </Stack>
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
