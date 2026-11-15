import { BookOpen } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { awaitedHost } from "@/features/hosts/index.ts";
import { EmptyState, SplitView } from "@/shared/layout/index.ts";
import { HistoryList } from "../features/history/history-list.tsx";
import { sessionsSplit } from "../features/sessions/sessions-split.tsx";
import { actionOfRoute, endMeasure } from "../lib/measures.ts";
import type { Route } from "../lib/router.ts";
import { routeDetail } from "./route-screens.tsx";
import type { ScreenProps } from "./screen-states.tsx";

/**
 * The screen of a route. `go` opens another one (the history keeps this one). Sessões and
 * Histórico are three columns: the list stays on the left and the open session, the transcript or
 * the new-session form shows on the right; the others use the whole width.
 */
export function Screen(props: ScreenProps) {
  const { state } = props;
  // The click of a measured action ends when its screen is painted.
  useEffect(() => {
    const action = actionOfRoute(props.route);
    if (action) endMeasure(action);
  }, [props.route]);
  // A host removed while its screen was open: back to the hub.
  const waiting = awaitedHost(props.route);
  const removed =
    waiting !== null && state.hostsLoaded && !state.hosts.some((h) => h.id === waiting);
  const route: Route = removed ? { name: "hub" } : props.route;
  const detail = routeDetail({ ...props, route });
  // Settings, the host form and the first start (no host) use the whole width.
  if (route.name === "settings" || route.name === "add-host" || state.hosts.length === 0) {
    return detail;
  }

  if (isHistoryRoute(route)) return historySplit(props, route, detail);
  return sessionsSplit(props, route, detail);
}

type HistoryRoute = Extract<Route, { name: "history" | "reader" }>;

/** Histórico, or a transcript opened from it: the list stays on the left. */
function isHistoryRoute(route: Route): route is HistoryRoute {
  return route.name === "history" || (route.name === "reader" && route.list === "history");
}

/** The filters a history route carries; undefined when it carries none. */
function historyFilters(route: Extract<Route, { name: "history" }>) {
  const { cwd, projectKey, day, from, to } = route;
  return cwd || projectKey || day || from || to ? { cwd, projectKey, day, from, to } : undefined;
}

/** Histórico: the list of past sessions on the left, the transcript (when one is open) on the right. */
function historySplit(props: ScreenProps, route: HistoryRoute, detail: ReactNode): ReactNode {
  const { store, state, go } = props;
  const { t } = store.i18n;
  const hostId = route.name === "history" ? route.host : route.target.hostId;
  // A host that is not online yet shows its own loading screen, without the list.
  if (awaitedHost(route) && state.hosts.find((h) => h.id === hostId)?.status !== "online") {
    return detail;
  }
  return (
    <SplitView
      list={
        <HistoryList
          key={hostId}
          store={store}
          hostId={hostId}
          initial={route.name === "history" ? historyFilters(route) : undefined}
          hostName={state.hosts.find((h) => h.id === hostId)?.name ?? hostId}
          density={props.density}
          openId={route.name === "reader" ? route.target.claudeSessionId : null}
          onOpen={(claudeSessionId) =>
            go({ name: "reader", target: { hostId, claudeSessionId }, list: "history" })
          }
        />
      }
      detail={route.name === "reader" ? detail : null}
      empty={
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState icon={BookOpen} title={t("history.pick")} />
        </div>
      }
      onClose={() => go({ name: "history", host: hostId })}
      labels={{ resize: t("hub.resize"), back: t("hub.back") }}
      initialWidth={store.viewPrefs.listWidth()}
      onResize={(width) => store.viewPrefs.setListWidth(width)}
    />
  );
}
