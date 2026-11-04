import { type LucideIcon, Settings } from "lucide-react";
import { useEffect } from "react";
import { Page } from "@/components/layout/page";
import { EmptyState } from "@/components/layout/states";
import { NAV_ICONS } from "@/components/nav-icons";
import { SessionTiles } from "@/components/projects/session-tiles";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { HubRowState } from "../lib/hub.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

interface Destination {
  key: string;
  labelKey: Key;
  hint: Key;
  icon: LucideIcon;
  route: Route;
}

/** One project: where Board, Sessions, Workflows, Costs and its settings open from (issue #9). */
export function ProjectPage(props: {
  store: AppStore;
  state: Pick<AppState, "projects"> & HubRowState;
  hostId: string;
  projectId: string;
  go(route: Route): void;
}) {
  const { store, state, hostId, projectId } = props;
  const { t } = store.i18n;
  const host = state.hosts.find((h) => h.id === hostId);
  const project = state.projects[hostId]?.find((p) => p.id === projectId);

  useEffect(() => {
    if (!state.projects[hostId]) void store.loadProjects(hostId);
  }, [store, hostId, state.projects]);

  if (!project) {
    return (
      <Page title={projectId}>
        <EmptyState title={t("projectPage.notHere")} />
      </Page>
    );
  }

  const destinations: Destination[] = [
    {
      key: "board",
      labelKey: "sidebar.board",
      hint: "projectPage.boardHint",
      icon: NAV_ICONS.board,
      route: { name: "board", host: hostId, projectId },
    },
    {
      key: "sessions",
      labelKey: "sidebar.sessions",
      hint: "projectPage.sessionsHint",
      icon: NAV_ICONS.sessions,
      route: {
        name: "hub",
        project: { hostId, projectKey: store.projectKeyOf(hostId, project), name: project.name },
      },
    },
    {
      key: "workflows",
      labelKey: "sidebar.workflows",
      hint: "projectPage.workflowsHint",
      icon: NAV_ICONS.workflows,
      route: { name: "workflows", host: hostId, projectId, projectName: project.name },
    },
    ...(hasFeature(host?.hostInfo?.features, "costs", false)
      ? [
          {
            key: "costs",
            labelKey: "sidebar.costs" as const,
            hint: "projectPage.costsHint" as const,
            icon: NAV_ICONS.costs,
            route: { name: "costs" } as Route,
          },
        ]
      : []),
    {
      key: "settings",
      labelKey: "sidebar.settings",
      hint: "projectPage.settingsHint",
      icon: Settings,
      route: { name: "projects", host: hostId },
    },
  ];

  return (
    <Page
      title={project.name}
      subtitle={`${host?.name ?? hostId} · ${project.baseBranch} · ${project.path}`}
    >
      <ul aria-label={project.name} className="card-grid" data-slot="project-destinations">
        {destinations.map(({ key, labelKey, hint, icon: Icon, route }) => (
          <li key={key}>
            <button
              type="button"
              aria-label={t(labelKey)}
              className="card-link rounded-lg border bg-card text-left hover:bg-accent/40 focus-visible:ring-2"
              onClick={() => props.go(route)}
            >
              <Icon
                aria-hidden="true"
                className="icon-nudge size-5 shrink-0 text-muted-foreground"
              />
              <span className="stack-hair">
                <span className="font-medium">{t(labelKey)}</span>
                <span className="text-muted-foreground text-sm">{t(hint)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <SessionTiles
        store={store}
        state={state}
        hostId={hostId}
        projectKey={store.projectKeyOf(hostId, project)}
        onOpen={(row) => props.go({ name: "session", host: hostId, id: row.sessionId as string })}
      />
    </Page>
  );
}
