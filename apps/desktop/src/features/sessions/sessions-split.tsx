import { MessagesSquare } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Density } from "@/features/shell/index.ts";
import { EmptyState, SplitView } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { QuotaPanel } from "../quota/ui.ts";
import { type HubRow, newSessionHost, rowRoute } from "./index.ts";
import { SessionsHub } from "./sessions-hub.tsx";

/** What the Sessões split reads from a screen's props. */
interface SessionsSplitProps {
  store: AppStore;
  state: ComponentProps<typeof SessionsHub>["state"];
  density: Density;
  go(route: Route): void;
}

/** The session open on the right of Sessões, if any (its daemon id or its Claude id). */
function openedSession(
  route: Route,
  state: Pick<AppState, "selected">,
): { id?: string; claude?: string } {
  if (route.name === "session") return { id: route.id };
  if (route.name === "external") return { claude: route.claudeSessionId };
  if (route.name === "reader") return { claude: route.target.claudeSessionId };
  if (route.name === "home" && state.selected?.sessionId) return { id: state.selected.sessionId };
  return {};
}

/** The routes of Sessões: the list on the left, the open session or the new-session form on the right. */
const SESSIONS_ROUTES: ReadonlySet<Route["name"]> = new Set([
  "hub",
  "home",
  "session",
  "external",
  "new-session",
  "reader",
]);

/** Whether the row is the session open on the right (by its daemon id or its Claude id). */
function rowIsOpen(row: HubRow, opened: { id?: string; claude?: string }): boolean {
  return (
    (opened.id !== undefined && row.sessionId === opened.id) ||
    (opened.claude !== undefined && row.claudeSessionId === opened.claude)
  );
}

/** What the right side shows when no session is open: a hint, the new-session button and the quota. */
function sessionsEmpty(props: SessionsSplitProps): ReactNode {
  const { store, state, go } = props;
  const firstHost = newSessionHost(state.hosts, state.selected);
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <EmptyState
        icon={MessagesSquare}
        title={store.i18n.t("hub.pick")}
        action={
          firstHost && (
            <Button
              onClick={() => {
                store.subscriptions.select(firstHost.id, null);
                go({ name: "new-session", host: firstHost.id });
              }}
            >
              {store.i18n.t("sidebar.newSession")}
            </Button>
          )
        }
      />
      <QuotaPanel store={store} />
    </div>
  );
}

/** Sessões: the list of sessions on the left, the open one on the right; other routes use the whole width. */
export function sessionsSplit(
  props: SessionsSplitProps,
  route: Route,
  detail: ReactNode,
): ReactNode {
  const { store, state, go } = props;
  const { t } = store.i18n;
  if (!SESSIONS_ROUTES.has(route.name)) return detail;
  // Waiting for a host (a reader or the like) keeps the loading screen as it is.
  if (
    route.name === "reader" &&
    state.hosts.find((h) => h.id === route.target.hostId)?.status !== "online"
  ) {
    return detail;
  }
  const opened = openedSession(route, state);
  return (
    <SplitView
      list={
        <SessionsHub
          store={store}
          state={state}
          density={props.density}
          project={route.name === "hub" ? route.project : undefined}
          host={route.name === "hub" ? route.host : undefined}
          onOpen={(row) => go(rowRoute(row))}
          isOpen={(row) => rowIsOpen(row, opened)}
        />
      }
      detail={detail}
      empty={sessionsEmpty(props)}
      onClose={() => go({ name: "hub" })}
      labels={{ resize: t("hub.resize"), back: t("hub.back") }}
      initialWidth={store.viewPrefs.listWidth()}
      onResize={(width) => store.viewPrefs.setListWidth(width)}
    />
  );
}
