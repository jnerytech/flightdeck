import type { CommandPayload } from "@flightdeck/protocol";
import { BookOpen, MessagesSquare } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TranscriptReader } from "@/features/history/index.ts";
import { awaitedHost, type HostDraft } from "@/features/hosts/index.ts";
import { draftUrl, FirstRun, HostForm, HostOfflineBanner } from "@/features/hosts/ui.ts";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { ExternalView } from "@/features/sessions/external-session-view.tsx";
import type { HubRow } from "@/features/sessions/index.ts";
import { newSessionHost, rowRoute } from "@/features/sessions/index.ts";
import type { Density, ThemeMode } from "@/features/shell/index.ts";
import { useT } from "@/i18n/context";
import type { Lang } from "@/i18n/index";
import { EmptyState, LoadingState, Page, SplitView } from "@/shared/layout/index.ts";
import { lazyScreen } from "../app/lazy-screen.ts";
import { ActivityBoard } from "../features/activity/board.tsx";
import type { TopSession } from "../features/costs/page.tsx";
import { HistoryList } from "../features/history/history-list.tsx";
import { NeedsYou } from "../features/needs-you/page.tsx";
import { QuotaPanel } from "../features/quota/ui.ts";
import { ManagedSession } from "../features/sessions/managed-session.tsx";
import { NewSessionForm } from "../features/sessions/new-session-form.tsx";
import { SessionTabs } from "../features/sessions/session-tabs.tsx";
import { SessionsHub } from "../features/sessions/sessions-hub.tsx";
import { StartScreen } from "../features/sessions/start-screen.tsx";
import { SetupPage } from "../features/setup/page.tsx";
import { TerminalPage } from "../features/terminal/ui.ts";
import type { AppState, AppStore, HostView, PendingItem } from "../lib/app-store.ts";
import { actionOfRoute, endMeasure } from "../lib/measures.ts";
import type { Route } from "../lib/router.ts";
import { hasFeature } from "../lib/version.ts";

/**
 * The screens the first one does not need are loaded when their route opens (`bundle:budget`
 * keeps the entry chunk under its limit; scripts/test/demo/screens-lazy.test.ts lists them).
 */
const ActionsPage = lazyScreen(() => import("../features/actions/page.tsx"), "ActionsPage");
const AgentPage = lazyScreen(() => import("../features/agentcfg/page.tsx"), "AgentPage");
const Approvals = lazyScreen(() => import("../features/permissions/page.tsx"), "AutoApprovalsPage");
const Automations = lazyScreen(() => import("../features/automations/page.tsx"), "AutomationsPage");
const BoardView = lazyScreen(() => import("../features/board/board-view.tsx"), "BoardView");
const CardDetail = lazyScreen(() => import("../features/board/card-detail.tsx"), "CardDetail");
const ClientsPage = lazyScreen(() => import("../features/clients/page.tsx"), "ClientsPage");
const ConnectionsPage = lazyScreen(() => import("../features/ssh/page.tsx"), "ConnectionsPage");
const Messaging = lazyScreen(() => import("../features/messaging/page.tsx"), "ConversationsPage");
const PrsPage = lazyScreen(() => import("../features/board/pull-requests.tsx"), "PullRequestsPage");
const CostsPage = lazyScreen(() => import("../features/costs/page.tsx"), "CostsPage");
const HomePage = lazyScreen(() => import("../features/home/page.tsx"), "HomePage");
const HostPage = lazyScreen(() => import("../features/hosts/page.tsx"), "HostPage");
const PersonasPage = lazyScreen(() => import("../features/personas/page.tsx"), "PersonasPage");
const PluginsPage = lazyScreen(() => import("../features/plugins/page.tsx"), "PluginsPage");
const PreviewPage = lazyScreen(() => import("../features/runenv/page.tsx"), "PreviewPage");
const ProjectsPage = lazyScreen(() => import("../features/projects/page.tsx"), "ProjectsPage");
const Overview = lazyScreen(() => import("../features/projects/overview.tsx"), "ProjectsOverview");
const ProjectPage = lazyScreen(() => import("../features/projects/project.tsx"), "ProjectPage");
const SnippetsPage = lazyScreen(() => import("../features/snippets/page.tsx"), "SnippetsPage");
const TeamsPage = lazyScreen(() => import("../features/teams/page.tsx"), "TeamsPage");
const VaultPage = lazyScreen(() => import("../features/vault/page.tsx"), "VaultPage");
const WorkflowsPage = lazyScreen(() => import("../features/workflows/page.tsx"), "WorkflowsPage");
const Settings = lazyScreen(() => import("../features/settings/page.tsx"), "Settings");

/** Adding a host: by hand, or prefilled by a pairing link (saving still needs the click). */
function AddHost(
  props: Readonly<{
    store: AppStore;
    draft?: HostDraft;
    empty: boolean;
    go(r: Route): void;
  }>,
) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (draft: HostDraft) => {
    setError(null);
    const result = await props.store.roster.testAndAdd({
      name: draft.name,
      url: draftUrl(draft),
      token: draft.token,
    });
    // A new host opens its own page: that is where it is checked and its folders are chosen.
    if (result.ok) props.go({ name: "host", host: result.hostId });
    else setError(result.error);
  };
  const { t } = props.store.i18n;
  // A page: a title, and a body that scrolls from its top. A centered box that scrolled hid the
  // top of a screen taller than the window, out of reach (#728).
  return (
    <Page
      title={t(props.empty ? "welcome.title" : "welcome.titleMore")}
      {...(props.empty ? { subtitle: t("welcome.addHost") } : {})}
    >
      <div className="flex w-full max-w-xl flex-col gap-6">
        <FirstRun onCopy={(text) => void props.store.system.copyText(text)} />
        <HostForm
          {...(props.draft
            ? {
                initial: props.draft,
                notice: props.store.i18n.t("hostForm.fromLink"),
              }
            : {})}
          error={error}
          onSubmit={(draft) => submit(draft)}
        />
      </div>
    </Page>
  );
}

interface ScreenProps {
  route: Route;
  store: AppStore;
  state: AppState;
  theme: ThemeMode;
  density: Density;
  go(route: Route): void;
  /** A request from the Precisa de você screen: its session, card or terminal view. */
  onOpenRequest(item: PendingItem): void;
}

/** The session open on the right of Sessões, if any (its daemon id or its Claude id). */
function openedSession(route: Route, state: AppState): { id?: string; claude?: string } {
  if (route.name === "session") return { id: route.id };
  if (route.name === "external") return { claude: route.claudeSessionId };
  if (route.name === "reader") return { claude: route.target.claudeSessionId };
  if (route.name === "home" && state.selected?.sessionId) return { id: state.selected.sessionId };
  return {};
}

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
  // A route with nothing of its own (`null`) keeps its empty pane: only a screen waits in Suspense.
  const inner = routeScreen({ ...props, route });
  const detail = inner === null ? null : <Suspense fallback={<LoadingScreen />}>{inner}</Suspense>;
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
function sessionsEmpty(props: ScreenProps): ReactNode {
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
function sessionsSplit(props: ScreenProps, route: Route, detail: ReactNode): ReactNode {
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

/**
 * Props that are functions keep their identity between renders, so the `memo` of the page they go
 * to holds: one set per store, one opener per `go`.
 */
const SETTINGS_ACTIONS = new WeakMap<AppStore, ReturnType<typeof makeSettingsActions>>();
function makeSettingsActions(store: AppStore) {
  return {
    onCloseToTray: (enabled: boolean) => void store.settings.setCloseToTray(enabled),
    onAutostart: (enabled: boolean) => void store.settings.setAutostart(enabled),
    onGlobalShortcut: (text: string) => void store.settings.setGlobalShortcut(text),
    onCheckUpdate: () => void store.appUpdates.check(),
    onNotifyUpdates: (enabled: boolean) => store.settings.setNotifyUpdates(enabled),
    onAutoUpdate: (enabled: boolean) => store.settings.setAutoUpdate(enabled),
    onTheme: (mode: ThemeMode) => store.theme.setMode(mode),
    onDensity: (density: Density) => store.density.set(density),
    onLang: (next: Lang) => store.i18n.setLang(next),
  };
}
function settingsActions(store: AppStore) {
  const known = SETTINGS_ACTIONS.get(store);
  if (known) return known;
  const actions = makeSettingsActions(store);
  SETTINGS_ACTIONS.set(store, actions);
  return actions;
}

type OpenCostSession = (hostId: string, session: TopSession) => void;
const COSTS_OPENERS = new WeakMap<(route: Route) => void, OpenCostSession>();
function costsOpener(go: (route: Route) => void): OpenCostSession {
  let opener = COSTS_OPENERS.get(go);
  if (!opener) {
    opener = (hostId, session) =>
      go(
        session.sessionId
          ? { name: "session", host: hostId, id: session.sessionId }
          : { name: "reader", target: { hostId, claudeSessionId: session.claudeSessionId } },
      );
    COSTS_OPENERS.set(go, opener);
  }
  return opener;
}

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
function LoadingScreen() {
  const t = useT();
  return <ScreenLoading label={t("states.loading")} />;
}

type HostInfo = AppState["hosts"][number];

/**
 * Screens that ask their host for data on opening wait for it to be online: a route can come
 * before the connection (a deep link at start-up). `undefined` when there is nothing to wait for.
 */
function hostWaitScreen(props: ScreenProps): ReactNode {
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

/** A session of another tool on the host: its tabs and its view, with the host's features as switches. */
function externalScreen(
  props: ScreenProps,
  route: Extract<Route, { name: "external" }>,
  host: HostInfo | undefined,
): ReactNode {
  const { store, state, go } = props;
  const features = host?.hostInfo?.features;
  const has = (name: string) => hasFeature(features, name, false);
  return (
    <SessionTabs
      key={`${route.host}/${route.claudeSessionId}`}
      viewKey={`${route.host}/${route.claudeSessionId}`}
      // Issue #107: the PTY the session was started from, when there is one.
      {...(store.terminals.embedded(route.host)
        ? {
            terminal: {
              launch: state.externals[`${route.host}/${route.claudeSessionId}`]?.launchId ?? null,
            },
          }
        : {})}
      store={store}
      hostId={route.host}
      claudeSessionId={route.claudeSessionId}
      enabled={has("review")}
      messagingId={has("messaging") ? route.claudeSessionId : null}
      telemetry={has("telemetry")}
      trace={has("trace")}
      files={has("file.list")}
    >
      <ExternalView
        store={store}
        state={state}
        hostId={route.host}
        hostName={host?.name ?? route.host}
        claudeSessionId={route.claudeSessionId}
        onResumed={() => go({ name: "home" })}
        {...(has("snippets")
          ? {
              prompts: store.snippets.prompts(
                route.host,
                state.externals[`${route.host}/${route.claudeSessionId}`]?.cwd ?? "",
              ),
            }
          : {})}
      />
    </SessionTabs>
  );
}

/** One host's page, with its actions wired to the router and the store. */
function hostScreen(props: ScreenProps, host: HostInfo): ReactNode {
  const { store, go } = props;
  return (
    <HostPage
      key={host.id}
      store={store}
      host={host}
      {...(props.route.name === "host" && props.route.section
        ? {
            section: props.route.section,
            // The ask is used up: the tab goes back to the plain host page. Only while the focused
            // tab still shows this ask, so another screen is never replaced.
            onSectionDone: () => {
              const now = store.router.current;
              if (now.name === "host" && now.host === host.id && now.section)
                store.router.replace({ name: "host", host: host.id });
            },
          }
        : {})}
      onRename={(name) => store.roster.rename(host.id, name)}
      onReconnect={() => void store.roster.reconnect(host.id)}
      onPairAgain={(input) => store.roster.pairAgain(host.id, input)}
      onOpenAutoApprovals={() => go({ name: "auto-approvals", host: host.id })}
      onOpenHistory={(f) => go({ name: "history", host: host.id, ...f })}
      onOpenSession={(row) => go(rowRoute(row))}
      onOpenProject={(card) =>
        go({ name: "project", host: card.hostId, projectId: card.projectId })
      }
      onSeeAllSessions={() => {
        // The hub applies the host for this visit only: the saved filter stays the person's.
        go({ name: "hub", host: host.name });
      }}
      onSeeAllProjects={() => go({ name: "all-projects", host: host.id })}
      onNewSession={() => go({ name: "new-session", host: host.id })}
      onRemove={() => {
        go({ name: "hub" });
        void store.roster.remove(host.id);
      }}
    />
  );
}

/** A host's projects, with the pages each one opens switched on by the host's features. */
function projectsScreen(
  props: ScreenProps,
  route: Extract<Route, { name: "projects" }>,
  host: HostInfo | undefined,
): ReactNode {
  const { store, go } = props;
  const has = (name: string) => hasFeature(host?.hostInfo?.features, name, false);
  const open =
    (name: "agent" | "workflows" | "automations" | "actions") =>
    ({ id, name: projectName }: { id: string; name: string }) =>
      go({ name, host: route.host, projectId: id, projectName });
  return (
    <ProjectsPage
      key={route.host}
      store={store}
      hostId={route.host}
      hostName={host?.name ?? route.host}
      rules={has("rules")}
      personas={has("personas")}
      agent={has("agentcfg")}
      onOpenAgent={open("agent")}
      {...(route.focus ? { focus: route.focus } : {})}
      onOpenBoard={(projectId) => go({ name: "board", host: route.host, projectId })}
      onOpenWorkflows={open("workflows")}
      automations={has("automation")}
      onOpenAutomations={open("automations")}
      actions={has("actions")}
      onOpenActions={open("actions")}
    />
  );
}

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
function filteredScreen(props: ScreenProps): ReactNode | undefined {
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

/** What a route shows on its own; `null` is the Sessões screen with nothing open. */
function routeScreen(props: ScreenProps): ReactNode {
  const { route, store, state, go } = props;
  const hostOf = (id: string) => state.hosts.find((h) => h.id === id);
  const waitScreen = hostWaitScreen(props);
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
  switch (route.name) {
    case "hub":
      return null;
    case "needs-you":
      return <NeedsYou store={store} state={state} go={go} onOpenRequest={props.onOpenRequest} />;
    case "activity":
      return (
        <ActivityBoard
          store={store}
          go={go}
          onOpen={(row, newTab) => {
            if (newTab) store.tabs.openNextInNewTab();
            go(rowRoute(row));
          }}
        />
      );
    case "pull-requests":
      return <PrsPage store={store} go={go} />;
    case "conversations":
      return <Messaging store={store} go={go} />;
    case "personas":
      return <PersonasPage store={store} go={go} />;
    case "clients":
      return <ClientsPage store={store} state={state} />;
    case "plugins":
      return <PluginsPage store={store} />;
    case "setup":
      return <SetupPage store={store} state={state} go={go} />;
    case "snippets":
      return <SnippetsPage store={store} go={go} />;
    case "connections":
      return <ConnectionsPage store={store} go={go} connect={route.connect} />;
    case "project":
      return (
        <ProjectPage
          key={`${route.host}/${route.projectId}`}
          store={store}
          state={state}
          hostId={route.host}
          projectId={route.projectId}
          go={go}
        />
      );
    case "overview":
      return <HomePage store={store} state={state} go={go} />;
    case "session":
      return (
        <ManagedSession
          key={`${route.host}/${route.id}`}
          store={store}
          state={state}
          hostId={route.host}
          sessionId={route.id}
          focus={route.focus ?? null}
          go={go}
        />
      );
    case "new-session": {
      // A host removed while its form is open: back to the hub.
      const host = hostOf(route.host);
      return host ? (
        <NewSession
          store={store}
          state={state}
          host={host}
          prompt={route.prompt}
          persona={route.persona}
        />
      ) : null;
    }
    case "external":
      return externalScreen(props, route, hostOf(route.host));
    case "reader":
      return (
        <TranscriptReader
          key={`${route.target.hostId}/${route.target.claudeSessionId}/${route.target.cursor ?? ""}`}
          store={store}
          target={route.target}
          hostName={hostOf(route.target.hostId)?.name ?? route.target.hostId}
          onResumed={() => go({ name: "home" })}
        />
      );
    case "history":
      // The list is drawn beside it (Screen).
      return null;
    case "host": {
      const host = hostOf(route.host);
      return host ? hostScreen(props, host) : null;
    }
    case "projects":
      return projectsScreen(props, route, hostOf(route.host));
    case "board":
      return (
        <BoardView
          key={`${route.host}/${route.projectId}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          newCard={route.newCard === true}
          onOpenCard={(cardId, edit) =>
            go({
              name: "card",
              host: route.host,
              projectId: route.projectId,
              cardId,
              ...(edit ? { edit: true as const } : {}),
            })
          }
          onOpenProject={(projectId) => go({ name: "board", host: route.host, projectId })}
          onOpenSettings={() => go({ name: "settings", section: "assistant" })}
        />
      );
    case "card":
      return (
        <CardDetail
          key={route.cardId}
          store={store}
          hostId={route.host}
          cardId={route.cardId}
          edit={route.edit === true}
          onOpenSettings={() => go({ name: "settings", section: "assistant" })}
          onBack={() => go({ name: "board", host: route.host, projectId: route.projectId })}
          onOpenCard={(cardId) =>
            go({ name: "card", host: route.host, projectId: route.projectId, cardId })
          }
          onOpenWorkflows={(project) =>
            go({
              name: "workflows",
              host: route.host,
              projectId: project.id,
              projectName: project.name,
            })
          }
        />
      );
    case "agent":
      return (
        <AgentPage
          key={`${route.host}/${route.projectId}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          projectName={route.projectName}
        />
      );
    case "automations":
      return (
        <Automations
          key={`${route.host}/${route.projectId}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          projectName={route.projectName}
        />
      );
    case "actions":
      return (
        <ActionsPage
          // A draft handed over opens a fresh screen, with its form.
          key={`${route.host}/${route.projectId}/${JSON.stringify(route.draft ?? null)}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          projectName={route.projectName}
          draft={route.draft}
        />
      );
    case "auto-approvals":
      return <Approvals key={route.host} store={store} hostId={route.host} />;
    case "preview":
      return <PreviewPage key={route.url} store={store} url={route.url} title={route.title} />;
    case "terminal":
      return (
        <TerminalPage
          key={`${route.host}/${route.terminalId}`}
          store={store}
          hostId={route.host}
          terminalId={route.terminalId}
          onClosed={() => store.hostTabs.close(store.hostTabs.activeId)}
        />
      );
    case "workflows":
      return (
        <WorkflowsPage
          key={`${route.host}/${route.projectId}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          projectName={route.projectName}
        />
      );
  }
  // "home": the selected session, the selected host's new-session form, or the hub.
  const selected = state.selected;
  if (selected?.sessionId && hostOf(selected.hostId)) {
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
  const selectedHost = selected ? hostOf(selected.hostId) : undefined;
  if (selectedHost) return <NewSession store={store} state={state} host={selectedHost} />;
  return null;
}

/** "Iniciar em segundo plano": the session runs under Claude Code's supervisor; the hub shows it. */
async function startInBackground(
  store: AppStore,
  hostId: string,
  payload: CommandPayload<"session.create">,
  persona: string,
): Promise<void> {
  const id = await store.background.start(hostId, {
    cwd: payload.cwd,
    prompt: payload.prompt,
    ...(payload.name ? { name: payload.name } : {}),
    ...(persona.startsWith("host:") ? { persona: persona.slice(5) } : {}),
  });
  if (id) store.router.push({ name: "hub" });
}

/** The new-session form of a host; the created session opens. */
function NewSession(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    host: HostView;
    prompt?: string;
    persona?: string;
  }>,
) {
  const { host } = props;
  const t = useT();
  // The persona the route asked for, else the one chosen, else the folder's client's default.
  const [picked, setPicked] = useState<string | null>(props.persona ?? null);
  const [cwd, setCwd] = useState("");
  const persona = picked ?? props.store.clientScope.get().defaultPersona(host.id, cwd);
  const [background, setBackground] = useState(false);
  const personas = hasFeature(host.hostInfo?.features, "personas", false);
  const withBackground = hasFeature(host.hostInfo?.features, "bg", false);
  return (
    <NewSessionForm
      key={`${host.id}/${props.prompt ?? ""}`}
      store={props.store}
      host={host}
      hosts={props.state.hosts.filter((h) => h.status === "online")}
      onHost={(hostId) => props.store.router.push({ name: "new-session", host: hostId })}
      onAddFolder={() => props.store.router.push({ name: "host", host: host.id })}
      {...(props.prompt ? { prompt: props.prompt } : {})}
      onFolder={setCwd}
      promptRequired={background}
      extraSet={background || persona !== ""}
      extra={
        <>
          {personas && (
            <PersonaPicker
              store={props.store}
              hostId={host.id}
              label={t("personas.picker.label")}
              value={persona}
              onChange={setPicked}
            />
          )}
          {withBackground && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                />{" "}
                {t("bg.start")}
              </label>
              <span className="text-muted-foreground text-xs">{t("bg.startHint")}</span>
            </>
          )}
        </>
      }
      // The created session opens by itself (SessionCommandsSlice.create).
      onCreate={(payload) => {
        if (payload.runtime === "opencode") return props.store.commands.create(host.id, payload);
        if (background) return startInBackground(props.store, host.id, payload, persona);
        const ref = props.store.personas.ref(persona);
        return props.store.commands.create(host.id, {
          ...payload,
          ...(ref ? { persona: ref } : {}),
        });
      }}
    />
  );
}
