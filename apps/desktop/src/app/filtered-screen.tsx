import type { ReactNode } from "react";
import { lazyScreen } from "../app/lazy-screen.ts";
import { costsOpener } from "../features/costs/ui.ts";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import type { ScreenProps } from "./screen-states.tsx";

/** The filtered screens load when their route opens, like the other screens (`route-screens.tsx`). */
const CostsPage = lazyScreen(() => import("../features/costs/page.tsx"), "CostsPage");
const Overview = lazyScreen(() => import("../features/projects/overview.tsx"), "ProjectsOverview");
const TeamsPage = lazyScreen(() => import("../features/teams/page.tsx"), "TeamsPage");
const VaultPage = lazyScreen(() => import("../features/vault/page.tsx"), "VaultPage");

/** The costs, narrowed by whatever the route names: a host, a project, a client or a period. */
function costsScreen(
  store: AppStore,
  route: Extract<Route, { name: "costs" }>,
  go: (route: Route) => void,
): ReactNode {
  return (
    <CostsPage
      store={store}
      onOpenSession={costsOpener(go)}
      {...(route.host ? { host: route.host } : {})}
      {...(route.projectKey ? { projectKey: route.projectKey } : {})}
      {...(route.client ? { client: route.client } : {})}
      {...(route.period ? { period: route.period } : {})}
    />
  );
}

/** The screens a route narrows with an optional host, team, rule or the costs' filters; undefined for the others. */
export function filteredScreen(props: ScreenProps): ReactNode | undefined {
  const { route, store, state, go } = props;
  switch (route.name) {
    case "teams":
      return (
        <TeamsPage
          store={store}
          {...(route.host ? { host: route.host } : {})}
          {...(route.team ? { team: route.team } : {})}
          go={go}
        />
      );
    case "all-projects":
      return (
        <Overview
          store={store}
          state={state}
          {...(route.host ? { host: route.host } : {})}
          onClearHost={() => go({ name: "all-projects" })}
          onOpen={(card) => go({ name: "project", host: card.hostId, projectId: card.projectId })}
          onAdded={(hostId, project) =>
            go({ name: "project", host: hostId, projectId: project.id })
          }
        />
      );
    case "costs":
      return costsScreen(store, route, go);
    case "vault":
      return (
        <VaultPage
          key={JSON.stringify(route.rule ?? null)}
          store={store}
          {...(route.rule ? { rule: route.rule } : {})}
        />
      );
    default:
      return undefined;
  }
}
