import { type ReactNode, Suspense } from "react";
import { TranscriptReader } from "@/features/history/ui.ts";
import { AddHost } from "@/features/hosts/ui.ts";
import { rowRoute } from "@/features/sessions/index.ts";
import { externalScreen, hostScreen, projectsScreen } from "../app/host-screens.tsx";
import { lazyScreen } from "../app/lazy-screen.ts";
import { hostWaitScreen, LoadingScreen, type ScreenProps } from "../app/screen-states.tsx";
import { ActivityBoard } from "../features/activity/board.tsx";
import { costsOpener } from "../features/costs/ui.ts";
import { NeedsYou } from "../features/needs-you/page.tsx";
import { ManagedSession } from "../features/sessions/managed-session.tsx";
import { NewSession } from "../features/sessions/new-session.tsx";
import { StartScreen } from "../features/sessions/start-screen.tsx";
import { settingsActions } from "../features/settings/ui.ts";
import { SetupPage } from "../features/setup/page.tsx";
import { TerminalPage } from "../features/terminal/ui.ts";
import type { AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";

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
const PersonasPage = lazyScreen(() => import("../features/personas/page.tsx"), "PersonasPage");
const PluginsPage = lazyScreen(() => import("../features/plugins/page.tsx"), "PluginsPage");
const PreviewPage = lazyScreen(() => import("../features/runenv/page.tsx"), "PreviewPage");
const Overview = lazyScreen(() => import("../features/projects/overview.tsx"), "ProjectsOverview");
const ProjectPage = lazyScreen(() => import("../features/projects/project.tsx"), "ProjectPage");
const SnippetsPage = lazyScreen(() => import("../features/snippets/page.tsx"), "SnippetsPage");
const TeamsPage = lazyScreen(() => import("../features/teams/page.tsx"), "TeamsPage");
const VaultPage = lazyScreen(() => import("../features/vault/page.tsx"), "VaultPage");
const WorkflowsPage = lazyScreen(() => import("../features/workflows/page.tsx"), "WorkflowsPage");
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

/**
 * What a route shows in the detail pane: its screen under a Suspense that waits for the screen's
 * chunk, or `null` for a route with nothing of its own (it keeps its empty pane).
 */
export function routeDetail(props: ScreenProps): ReactNode {
  const inner = routeScreen(props);
  return inner === null ? null : <Suspense fallback={<LoadingScreen />}>{inner}</Suspense>;
}
