import { type ReactNode, Suspense } from "react";
import { AddHost } from "@/features/hosts/ui.ts";
import { filteredScreen } from "../app/filtered-screen.tsx";
import { lazyScreen } from "../app/lazy-screen.ts";
import { hostWaitScreen, LoadingScreen, type ScreenProps } from "../app/screen-states.tsx";
import { ManagedSession } from "../features/sessions/managed-session.tsx";
import { NewSession } from "../features/sessions/new-session.tsx";
import { StartScreen } from "../features/sessions/start-screen.tsx";
import { settingsActions } from "../features/settings/ui.ts";
import type { Route } from "../lib/router.ts";
import { BOARD_ROUTES } from "./board-routes.tsx";
import { PAGE_ROUTES } from "./page-routes.tsx";
import { hostOf } from "./route-table.ts";
import { SESSION_ROUTES } from "./session-routes.tsx";

/**
 * The screens the first one does not need are loaded when their route opens (`bundle:budget`
 * keeps the entry chunk under its limit; scripts/test/demo/screens-lazy.test.ts lists them). The
 * route tables load their own; this file loads Settings.
 */
const Settings = lazyScreen(() => import("../features/settings/page.tsx"), "Settings");

/** The form that adds a host: the route asks for it, or there is no host yet. */
function addHostScreen(props: ScreenProps): ReactNode {
  const { route, store, state, go } = props;
  const draft = route.name === "add-host" ? route.draft : undefined;
  return (
    <AddHost
      key={route.name === "add-host" ? (route.key ?? 0) : 0}
      store={store}
      empty={state.hosts.length === 0}
      go={go}
      {...(draft ? { draft } : {})}
    />
  );
}

const ROUTES: Partial<Record<Route["name"], AnyBuilder>> = {
  ...SESSION_ROUTES,
  ...BOARD_ROUTES,
  ...PAGE_ROUTES,
} as Partial<Record<Route["name"], AnyBuilder>>;
type AnyBuilder = (props: ScreenProps, route: Route) => ReactNode;

/** What a route shows on its own; `null` is the Sessões screen with nothing open. */
function routeScreen(props: ScreenProps): ReactNode {
  const { route, store, state, go } = props;
  const waitScreen = hostWaitScreen({
    route: props.route,
    store: props.store,
    hosts: props.state.hosts,
  });
  if (waitScreen !== undefined) return waitScreen;

  if (route.name === "start") return <StartScreen store={store} hosts={state.hosts} go={go} />;
  if (route.name === "settings") {
    return (
      <Settings
        store={store}
        settings={state.settings}
        section={route.section}
        {...settingsActions(store)}
        appUpdate={state.appUpdate}
        theme={props.theme}
        density={props.density}
        lang={store.i18n.lang}
        t={store.i18n.t}
      />
    );
  }
  if (route.name === "add-host" || state.hosts.length === 0) return addHostScreen(props);
  const filtered = filteredScreen(props);
  if (filtered !== undefined) return filtered;
  if (Object.hasOwn(ROUTES, route.name)) return ROUTES[route.name]?.(props, route);
  // "home": the selected session, the selected host's new-session form, or the hub.
  const selected = state.selected;
  if (selected?.sessionId && hostOf(props, selected.hostId)) {
    return (
      <ManagedSession
        key={`${selected.hostId}/${selected.sessionId}`}
        store={store}
        state={state}
        hostId={selected.hostId}
        sessionId={selected.sessionId}
        focus={null}
        go={go}
      />
    );
  }
  const selectedHost = selected ? hostOf(props, selected.hostId) : undefined;
  if (selectedHost) return <NewSession store={store} state={state} host={selectedHost} />;
  return null;
}

/**
 * What a route shows in the detail pane: its screen under a Suspense that waits for the screen's
 * chunk, or `null` for a route with nothing of its own (it keeps its empty pane).
 */
export function routeDetail(props: ScreenProps): ReactNode {
  const inner = routeScreen(props);
  return inner === null ? null : <Suspense fallback={<LoadingScreen />}>{inner}</Suspense>;
}
