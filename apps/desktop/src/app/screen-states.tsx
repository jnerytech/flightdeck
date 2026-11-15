import type { ReactNode } from "react";
import { awaitedHost } from "@/features/hosts/index.ts";
import { HostOfflineBanner } from "@/features/hosts/ui.ts";
import { useT } from "@/i18n/context";
import { LoadingState } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

export type HostInfo = AppState["hosts"][number];

/** What a screen shows instead of itself while it cannot open: the wait, or why it cannot. */
function ScreenState(props: Readonly<{ children: ReactNode }>) {
  return <div className="p-6">{props.children}</div>;
}

function ScreenLoading(props: Readonly<{ label: string }>) {
  return (
    <ScreenState>
      <LoadingState label={props.label} />
    </ScreenState>
  );
}

/** The wait for a screen that loads on demand; it translates itself, only while it is shown. */
export function LoadingScreen() {
  const t = useT();
  return <ScreenLoading label={t("states.loading")} />;
}

/**
 * Screens that ask their host for data on opening wait for it to be online: a route can come
 * before the connection (a deep link at start-up). `undefined` when there is nothing to wait for.
 */
export function hostWaitScreen(props: {
  route: Route;
  store: AppStore;
  state: AppState;
}): ReactNode {
  const { route, store, state } = props;
  const waiting = awaitedHost(route);
  if (!waiting) return undefined;
  const waitHost = state.hosts.find((h) => h.id === waiting);
  // Issue #227: once a try has failed, the host is down, not on its way: a spinner there was a dead
  // end. The host's banner says why and offers to reconnect.
  if (
    waitHost &&
    ((waitHost.status === "offline" && waitHost.retry) || waitHost.status === "unauthorized")
  ) {
    return (
      <ScreenState>
        <HostOfflineBanner
          host={waitHost}
          onReconnect={() => void store.roster.reconnect(waitHost.id)}
        />
      </ScreenState>
    );
  }
  if (waitHost?.status === "online") return undefined;
  const { t } = store.i18n;
  const label = waitHost ? t("states.connecting", { host: waitHost.name }) : t("states.loading");
  return <ScreenLoading label={label} />;
}
