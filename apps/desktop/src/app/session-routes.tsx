import { TranscriptReader } from "@/features/history/ui.ts";
import { rowRoute } from "@/features/sessions/index.ts";
import { ActivityBoard } from "../features/activity/board.tsx";
import { NeedsYou } from "../features/needs-you/page.tsx";
import { ManagedSession } from "../features/sessions/managed-session.tsx";
import { NewSession } from "../features/sessions/new-session.tsx";
import { externalScreen } from "./host-screens.tsx";
import { hostOf, type RouteTable } from "./route-table.ts";

/** The routes of a session and of the screens that lead to one. */
export const SESSION_ROUTES = {
  "needs-you": ({ store, state, go, onOpenRequest }) => (
    <NeedsYou store={store} state={state} go={go} onOpenRequest={onOpenRequest} />
  ),
  activity: ({ store, go }) => (
    <ActivityBoard
      store={store}
      go={go}
      onOpen={(row, newTab) => {
        if (newTab) store.tabs.openNextInNewTab();
        go(rowRoute(row));
      }}
    />
  ),
  session: ({ store, state, go }, route) => (
    <ManagedSession
      key={`${route.host}/${route.id}`}
      store={store}
      state={state}
      hostId={route.host}
      sessionId={route.id}
      focus={route.focus ?? null}
      go={go}
    />
  ),
  "new-session": (props, route) => {
    // A host removed while its form is open: back to the hub.
    const host = hostOf(props, route.host);
    return host ? (
      <NewSession
        store={props.store}
        state={props.state}
        host={host}
        prompt={route.prompt}
        persona={route.persona}
      />
    ) : null;
  },
  external: (props, route) => externalScreen(props, route, hostOf(props, route.host)),
  reader: (props, route) => (
    <TranscriptReader
      key={`${route.target.hostId}/${route.target.claudeSessionId}/${route.target.cursor ?? ""}`}
      store={props.store}
      target={route.target}
      hostName={hostOf(props, route.target.hostId)?.name ?? route.target.hostId}
      onResumed={() => props.go({ name: "home" })}
    />
  ),
  // The list is drawn beside it (Screen).
  history: () => null,
} satisfies RouteTable<
  "needs-you" | "activity" | "session" | "new-session" | "external" | "reader" | "history"
>;
