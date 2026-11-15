import { MessagesSquare } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Density } from "@/features/shell/index.ts";
import { EmptyState, SplitView } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import type { Route } from "../../lib/router.ts";
import { QuotaPanel } from "../quota/ui.ts";
import { openedSession, rowIsOpen, SESSIONS_ROUTES } from "./domain/sessions-split.ts";
import { newSessionHost, rowRoute } from "./index.ts";
import { SessionsHub } from "./sessions-hub.tsx";

/** What the Sessões split reads from a screen's props. */
interface SessionsSplitProps {
  store: AppStore;
  state: ComponentProps<typeof SessionsHub>["state"];
  density: Density;
  go(route: Route): void;
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
