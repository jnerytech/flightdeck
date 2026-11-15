import { SetupPage } from "../features/setup/page.tsx";
import { TerminalPage } from "../features/terminal/ui.ts";
import { hostScreen, projectsScreen } from "./host-screens.tsx";
import { lazyScreen } from "./lazy-screen.ts";
import { hostOf, type RouteTable } from "./route-table.ts";

const Approvals = lazyScreen(() => import("../features/permissions/page.tsx"), "AutoApprovalsPage");
const ClientsPage = lazyScreen(() => import("../features/clients/page.tsx"), "ClientsPage");
const ConnectionsPage = lazyScreen(() => import("../features/ssh/page.tsx"), "ConnectionsPage");
const Messaging = lazyScreen(() => import("../features/messaging/page.tsx"), "ConversationsPage");
const PersonasPage = lazyScreen(() => import("../features/personas/page.tsx"), "PersonasPage");
const PluginsPage = lazyScreen(() => import("../features/plugins/page.tsx"), "PluginsPage");
const PreviewPage = lazyScreen(() => import("../features/runenv/page.tsx"), "PreviewPage");
const SnippetsPage = lazyScreen(() => import("../features/snippets/page.tsx"), "SnippetsPage");

/** The routes of a host and of the pages that configure the app and its connections. */
export const PAGE_ROUTES = {
  hub: () => null,
  conversations: ({ store, go }) => <Messaging store={store} go={go} />,
  personas: ({ store, go }) => <PersonasPage store={store} go={go} />,
  clients: ({ store, state }) => <ClientsPage store={store} state={state} />,
  plugins: ({ store }) => <PluginsPage store={store} />,
  setup: ({ store, state, go }) => <SetupPage store={store} state={state} go={go} />,
  snippets: ({ store, go }) => <SnippetsPage store={store} go={go} />,
  connections: ({ store, go }, route) => (
    <ConnectionsPage store={store} go={go} connect={route.connect} />
  ),
  host: (props, route) => {
    const host = hostOf(props, route.host);
    return host ? hostScreen(props, host) : null;
  },
  projects: (props, route) => projectsScreen(props, route, hostOf(props, route.host)),
  "auto-approvals": ({ store }, route) => (
    <Approvals key={route.host} store={store} hostId={route.host} />
  ),
  preview: ({ store }, route) => (
    <PreviewPage key={route.url} store={store} url={route.url} title={route.title} />
  ),
  terminal: ({ store }, route) => (
    <TerminalPage
      key={`${route.host}/${route.terminalId}`}
      store={store}
      hostId={route.host}
      terminalId={route.terminalId}
      onClosed={() => store.hostTabs.close(store.hostTabs.activeId)}
    />
  ),
} satisfies RouteTable<
  | "hub"
  | "conversations"
  | "personas"
  | "clients"
  | "plugins"
  | "setup"
  | "snippets"
  | "connections"
  | "host"
  | "projects"
  | "auto-approvals"
  | "preview"
  | "terminal"
>;
