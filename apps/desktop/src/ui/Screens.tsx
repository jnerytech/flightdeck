import type { CommandPayload } from "@flightdeck/protocol";
import { BookOpen, MessagesSquare } from "lucide-react";
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { SplitView } from "@/components/layout/split-view";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { PersonaSwitch } from "@/components/personas/persona-switch";
import { useT } from "@/i18n/context";
import type { Lang } from "@/i18n/index";
import {
  type AppState,
  type AppStore,
  type HostView,
  type PendingItem,
  sessionKey,
} from "../lib/app-store.ts";
import type { Density } from "../lib/density.ts";
import type { HubRow } from "../lib/hub.ts";
import { actionOfRoute, endMeasure } from "../lib/measures.ts";
import { basename } from "../lib/paths.ts";
import type { Route } from "../lib/router.ts";
import { isBusy } from "../lib/status.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { useSessionState } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { CheckpointsButton } from "./Checkpoints.tsx";
import type { TopSession } from "./CostsPage.tsx";
import { ExternalView } from "./ExternalView.tsx";
import { FirstRun } from "./FirstRun.tsx";
import { HistoryList } from "./HistoryList.tsx";
import { draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { NeedsYou } from "./NeedsYou.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { QuotaPanel } from "./QuotaPanel.tsx";
import { SessionsHub } from "./SessionsHub.tsx";
import { SessionTabs } from "./SessionTabs.tsx";
import { SessionView } from "./SessionView.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { TerminalPage } from "./TerminalPage.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";

/**
 * The screens the first one does not need are loaded when their route opens (`bundle:budget`
 * keeps the entry chunk under its limit; scripts/test/screens-lazy.test.ts lists them).
 */
function lazyScreen<M extends Record<K, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
): M[K] {
  const component = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
  return component as unknown as M[K];
}

const ActionsPage = lazyScreen(() => import("./ActionsPage.tsx"), "ActionsPage");
const AgentPage = lazyScreen(() => import("./AgentPage.tsx"), "AgentPage");
const AutoApprovalsPage = lazyScreen(() => import("./AutoApprovalsPage.tsx"), "AutoApprovalsPage");
const AutomationsPage = lazyScreen(() => import("./AutomationsPage.tsx"), "AutomationsPage");
const BoardView = lazyScreen(() => import("./BoardView.tsx"), "BoardView");
const CardDetail = lazyScreen(() => import("./CardDetail.tsx"), "CardDetail");
const ClientsPage = lazyScreen(() => import("./ClientsPage.tsx"), "ClientsPage");
const ConnectionsPage = lazyScreen(() => import("./ConnectionsPage.tsx"), "ConnectionsPage");
const ConversationsPage = lazyScreen(() => import("./ConversationsPage.tsx"), "ConversationsPage");
const CostsPage = lazyScreen(() => import("./CostsPage.tsx"), "CostsPage");
const HostPage = lazyScreen(() => import("./HostPage.tsx"), "HostPage");
const PersonasPage = lazyScreen(() => import("./PersonasPage.tsx"), "PersonasPage");
const PluginsPage = lazyScreen(() => import("./PluginsPage.tsx"), "PluginsPage");
const PreviewPage = lazyScreen(() => import("./PreviewPage.tsx"), "PreviewPage");
const ProjectsPage = lazyScreen(() => import("./ProjectsPage.tsx"), "ProjectsPage");
const SnippetsPage = lazyScreen(() => import("./SnippetsPage.tsx"), "SnippetsPage");
const TeamsPage = lazyScreen(() => import("./TeamsPage.tsx"), "TeamsPage");
const VaultPage = lazyScreen(() => import("./VaultPage.tsx"), "VaultPage");
const WorkflowsPage = lazyScreen(() => import("./WorkflowsPage.tsx"), "WorkflowsPage");
const Settings = lazyScreen(() => import("./Settings.tsx"), "Settings");

/** The host a route's screen loads from when it opens, if any. */
function hostToWait(route: Route): string | null {
  switch (route.name) {
    case "reader":
      return route.target.hostId;
    case "external":
    case "history":
    case "projects":
    case "board":
    case "card":
    case "workflows":
    case "agent":
    case "automations":
    case "actions":
    case "auto-approvals":
    case "terminal":
      return route.host;
    default:
      return null;
  }
}

/** From the Sessões screen: the conversation, the live terminal view or the reader. */
export function rowRoute(row: HubRow): Route {
  const id = row.claudeSessionId as string;
  if (row.sessionId) return { name: "session", host: row.hostId, id: row.sessionId };
  if (row.origin === "terminal" && row.state !== "ended") {
    return { name: "external", host: row.hostId, claudeSessionId: id };
  }
  // A background session: its screen when the host knows its Claude session, else the hub.
  if (row.origin === "background") {
    return id ? { name: "external", host: row.hostId, claudeSessionId: id } : { name: "hub" };
  }
  return { name: "reader", target: { hostId: row.hostId, claudeSessionId: id } };
}

/** A managed session's conversation; selecting it subscribes to its full event stream. */
function ManagedSession(props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  sessionId: string;
  focus: string | null;
}) {
  const { store, state, hostId, sessionId } = props;
  const host = state.hosts.find((h) => h.id === hostId);
  useEffect(() => {
    if (state.selected?.hostId !== hostId || state.selected.sessionId !== sessionId) {
      store.select(hostId, sessionId);
    }
  }, [store, state.selected, hostId, sessionId]);
  const summary = host?.sessions.find((s) => s.id === sessionId);
  const session = useSessionState(store, sessionKey(hostId, sessionId));
  // Estimated cost of the session, once its claudeSessionId is known (phase 8): from its own
  // events, else from the Sessões list.
  const claudeId =
    session.claudeSessionId ??
    state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  const status = session.status;
  const [costUsd, setCostUsd] = useState<number | null>(null);
  useEffect(() => {
    setCostUsd(null);
    if (!claudeId || !withCosts || !status) return;
    void store
      .hostCommand(hostId, "costs.session", { claudeSessionId: claudeId })
      .then((r) => setCostUsd(r?.costUsd ?? null));
  }, [store, hostId, claudeId, withCosts, status]);
  return (
    <SessionTabs
      store={store}
      hostId={hostId}
      claudeSessionId={claudeId}
      enabled={hasFeature(host?.hostInfo?.features, "review", false)}
      messagingId={hasFeature(host?.hostInfo?.features, "messaging", false) ? sessionId : null}
      telemetry={hasFeature(host?.hostInfo?.features, "telemetry", false)}
      trace={hasFeature(host?.hostInfo?.features, "trace", false)}
    >
      <SessionView
        t={store.i18n.t}
        nowMs={store.now()}
        {...(hasFeature(host?.hostInfo?.features, "snippets", false)
          ? { prompts: store.promptSnippets(hostId, summary?.cwd ?? session.cwd ?? "") }
          : {})}
        title={summary?.name ?? basename(summary?.cwd ?? session.cwd ?? sessionId)}
        session={session}
        actions={store}
        focusRequestId={props.focus}
        alwaysAllow={hasFeature(host?.hostInfo?.features, "rules", false)}
        terminal={
          // Only once Claude Code named the session: there is nothing to resume before that.
          session.claudeSessionId && (
            <TerminalButton
              store={store}
              hostId={hostId}
              target={{
                cwd: summary?.cwd ?? session.cwd ?? "",
                claudeSessionId: session.claudeSessionId,
              }}
            />
          )
        }
        timeline={
          hasFeature(host?.hostInfo?.features, "checkpoints", false) &&
          session.claudeSessionId && (
            <CheckpointsButton
              store={store}
              hostId={hostId}
              claudeSessionId={session.claudeSessionId}
              cwd={summary?.cwd ?? session.cwd ?? ""}
              busy={isBusy(session.status)}
            />
          )
        }
        persona={
          hasFeature(host?.hostInfo?.features, "personas", false) && (
            <PersonaSwitch
              store={store}
              hostId={hostId}
              target={{ sessionId }}
              current={
                session.persona ??
                state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.persona ??
                null
              }
            />
          )
        }
        costUsd={costUsd}
      />
    </SessionTabs>
  );
}

/** Adding a host: by hand, or prefilled by a pairing link (saving still needs the click). */
function AddHost(props: {
  store: AppStore;
  draft?: HostDraft;
  empty: boolean;
  go(r: Route): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (draft: HostDraft) => {
    setError(null);
    const result = await props.store.testAndAddHost({
      name: draft.name,
      url: draftUrl(draft),
      token: draft.token,
    });
    if (result.ok) props.go({ name: "hub" });
    else setError(result.error);
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-6">
      {props.empty && (
        <>
          <p className="text-muted-foreground text-sm">{props.store.i18n.t("welcome.addHost")}</p>
          <FirstRun onCopy={(text) => void props.store.copyText(text)} />
        </>
      )}
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
  const { store, state, go } = props;
  // The click of a measured action ends when its screen is painted.
  useEffect(() => {
    const action = actionOfRoute(props.route);
    if (action) endMeasure(action);
  }, [props.route]);
  const { t } = store.i18n;
  // A host removed while its screen was open: back to the hub.
  const waiting = hostToWait(props.route);
  const removed =
    waiting !== null && state.hostsLoaded && !state.hosts.some((h) => h.id === waiting);
  const route: Route = removed ? { name: "hub" } : props.route;
  const detail = (
    <Suspense fallback={<ScreenLoading label={t("states.loading")} />}>
      {routeScreen({ ...props, route })}
    </Suspense>
  );
  // Settings, the host form and the first start (no host) use the whole width.
  if (route.name === "settings" || route.name === "add-host" || state.hosts.length === 0) {
    return detail;
  }

  const fromHistory =
    route.name === "history" || (route.name === "reader" && route.list === "history");
  if (fromHistory) {
    const hostId =
      route.name === "history"
        ? route.host
        : (route as { target: { hostId: string } }).target.hostId;
    // A host that is not online yet shows its own loading screen, without the list.
    if (hostToWait(route) && state.hosts.find((h) => h.id === hostId)?.status !== "online") {
      return detail;
    }
    const opened = route.name === "reader" ? route.target.claudeSessionId : null;
    return (
      <SplitView
        list={
          <HistoryList
            key={hostId}
            store={store}
            hostId={hostId}
            hostName={state.hosts.find((h) => h.id === hostId)?.name ?? hostId}
            density={props.density}
            openId={opened}
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
        initialWidth={store.listWidth()}
        onResize={(width) => store.setListWidth(width)}
      />
    );
  }

  const inSessions =
    route.name === "hub" ||
    route.name === "home" ||
    route.name === "session" ||
    route.name === "external" ||
    route.name === "new-session" ||
    route.name === "reader";
  if (!inSessions) return detail;
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
          onOpen={(row) => go(rowRoute(row))}
          isOpen={(row) =>
            (opened.id !== undefined && row.sessionId === opened.id) ||
            (opened.claude !== undefined && row.claudeSessionId === opened.claude)
          }
        />
      }
      detail={detail}
      empty={
        <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
          <EmptyState icon={MessagesSquare} title={t("hub.pick")} />
          <QuotaPanel store={store} />
        </div>
      }
      onClose={() => go({ name: "hub" })}
      labels={{ resize: t("hub.resize"), back: t("hub.back") }}
      initialWidth={store.listWidth()}
      onResize={(width) => store.setListWidth(width)}
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
    onCloseToTray: (enabled: boolean) => void store.setCloseToTray(enabled),
    onAutostart: (enabled: boolean) => void store.setAutostart(enabled),
    onGlobalShortcut: (text: string) => void store.setGlobalShortcut(text),
    onCheckUpdate: () => void store.checkAppUpdate(),
    onNotifyUpdates: (enabled: boolean) => store.setNotifyUpdates(enabled),
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

function ScreenLoading(props: { label: string }) {
  return (
    <div className="p-6">
      <LoadingState label={props.label} />
    </div>
  );
}

/** What a route shows on its own; `null` is the Sessões screen with nothing open. */
function routeScreen(props: ScreenProps): ReactNode {
  const { route, store, state, go } = props;
  const hostOf = (id: string) => state.hosts.find((h) => h.id === id);
  // Screens that ask their host for data on opening wait for it to be online: a route can come
  // before the connection (a deep link at start-up).
  const waiting = hostToWait(route);
  const waitHost = waiting ? hostOf(waiting) : undefined;
  if (waiting && waitHost?.status !== "online") {
    const { t } = store.i18n;
    const label = waitHost ? t("states.connecting", { host: waitHost.name }) : t("states.loading");
    return <ScreenLoading label={label} />;
  }

  if (route.name === "settings") {
    return (
      <Settings
        store={store}
        settings={state.settings}
        {...settingsActions(store)}
        appUpdate={state.appUpdate}
        theme={props.theme}
        density={props.density}
        lang={store.i18n.lang}
        t={store.i18n.t}
      />
    );
  }
  if (route.name === "add-host" || state.hosts.length === 0) {
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
  switch (route.name) {
    case "hub":
      return null;
    case "needs-you":
      return <NeedsYou store={store} state={state} go={go} onOpenRequest={props.onOpenRequest} />;
    case "teams":
      return <TeamsPage store={store} />;
    case "conversations":
      return <ConversationsPage store={store} go={go} />;
    case "personas":
      return <PersonasPage store={store} />;
    case "clients":
      return <ClientsPage store={store} state={state} />;
    case "plugins":
      return <PluginsPage store={store} />;
    case "snippets":
      return <SnippetsPage store={store} go={go} />;
    case "connections":
      return <ConnectionsPage store={store} go={go} connect={route.connect} />;
    case "costs":
      return <CostsPage store={store} onOpenSession={costsOpener(go)} />;
    case "vault":
      return (
        <VaultPage
          key={JSON.stringify(route.rule ?? null)}
          store={store}
          {...(route.rule ? { rule: route.rule } : {})}
        />
      );
    case "session":
      return (
        <ManagedSession
          key={`${route.host}/${route.id}`}
          store={store}
          state={state}
          hostId={route.host}
          sessionId={route.id}
          focus={route.focus ?? null}
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
      return (
        <SessionTabs
          key={`${route.host}/${route.claudeSessionId}`}
          store={store}
          hostId={route.host}
          claudeSessionId={route.claudeSessionId}
          enabled={hasFeature(hostOf(route.host)?.hostInfo?.features, "review", false)}
          messagingId={
            hasFeature(hostOf(route.host)?.hostInfo?.features, "messaging", false)
              ? route.claudeSessionId
              : null
          }
          telemetry={hasFeature(hostOf(route.host)?.hostInfo?.features, "telemetry", false)}
          trace={hasFeature(hostOf(route.host)?.hostInfo?.features, "trace", false)}
        >
          <ExternalView
            store={store}
            state={state}
            hostId={route.host}
            hostName={hostOf(route.host)?.name ?? route.host}
            claudeSessionId={route.claudeSessionId}
            onResumed={() => go({ name: "home" })}
            {...(hasFeature(hostOf(route.host)?.hostInfo?.features, "snippets", false)
              ? {
                  prompts: store.promptSnippets(
                    route.host,
                    state.externals[`${route.host}/${route.claudeSessionId}`]?.cwd ?? "",
                  ),
                }
              : {})}
          />
        </SessionTabs>
      );
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
      if (!host) return null;
      return (
        <HostPage
          key={host.id}
          store={store}
          host={host}
          onRename={(name) => store.renameHost(host.id, name)}
          onReconnect={() => void store.reconnectHost(host.id)}
          onOpenAutoApprovals={() => go({ name: "auto-approvals", host: host.id })}
          onRemove={() => {
            go({ name: "hub" });
            void store.removeHost(host.id);
          }}
        />
      );
    }
    case "projects": {
      const host = hostOf(route.host);
      return (
        <ProjectsPage
          key={route.host}
          store={store}
          hostId={route.host}
          hostName={host?.name ?? route.host}
          rules={hasFeature(host?.hostInfo?.features, "rules", false)}
          personas={hasFeature(host?.hostInfo?.features, "personas", false)}
          agent={hasFeature(host?.hostInfo?.features, "agentcfg", false)}
          onOpenAgent={({ id, name }) =>
            go({ name: "agent", host: route.host, projectId: id, projectName: name })
          }
          {...(route.focus ? { focus: route.focus } : {})}
          onOpenBoard={(projectId) => go({ name: "board", host: route.host, projectId })}
          onOpenWorkflows={({ id, name }) =>
            go({ name: "workflows", host: route.host, projectId: id, projectName: name })
          }
          automations={hasFeature(host?.hostInfo?.features, "automation", false)}
          onOpenAutomations={({ id, name }) =>
            go({ name: "automations", host: route.host, projectId: id, projectName: name })
          }
          actions={hasFeature(host?.hostInfo?.features, "actions", false)}
          onOpenActions={({ id, name }) =>
            go({ name: "actions", host: route.host, projectId: id, projectName: name })
          }
        />
      );
    }
    case "board":
      return (
        <BoardView
          key={`${route.host}/${route.projectId}`}
          store={store}
          hostId={route.host}
          projectId={route.projectId}
          onOpenCard={(cardId) =>
            go({ name: "card", host: route.host, projectId: route.projectId, cardId })
          }
        />
      );
    case "card":
      return (
        <CardDetail
          key={route.cardId}
          store={store}
          hostId={route.host}
          cardId={route.cardId}
          onBack={() => go({ name: "board", host: route.host, projectId: route.projectId })}
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
        <AutomationsPage
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
      return <AutoApprovalsPage key={route.host} store={store} hostId={route.host} />;
    case "preview":
      return <PreviewPage key={route.url} store={store} url={route.url} title={route.title} />;
    case "terminal":
      return (
        <TerminalPage
          key={`${route.host}/${route.terminalId}`}
          store={store}
          hostId={route.host}
          terminalId={route.terminalId}
          onClosed={() => store.tabs.close(store.tabs.activeId)}
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
  const id = await store.startBackground(hostId, {
    cwd: payload.cwd,
    prompt: payload.prompt,
    ...(payload.name ? { name: payload.name } : {}),
    ...(persona.startsWith("host:") ? { persona: persona.slice(5) } : {}),
  });
  if (id) store.router.push({ name: "hub" });
}

/** The new-session form of a host; the created session opens. */
function NewSession(props: {
  store: AppStore;
  state: AppState;
  host: HostView;
  prompt?: string | undefined;
  persona?: string | undefined;
}) {
  const { host } = props;
  const t = useT();
  // The persona the route asked for, else the one chosen, else the folder's client's default.
  const [picked, setPicked] = useState<string | null>(props.persona ?? null);
  const [cwd, setCwd] = useState("");
  const persona = picked ?? props.store.clientScope().defaultPersona(host.id, cwd);
  const [background, setBackground] = useState(false);
  const personas = hasFeature(host.hostInfo?.features, "personas", false);
  const withBackground = hasFeature(host.hostInfo?.features, "bg", false);
  return (
    <NewSessionForm
      key={`${host.id}/${props.prompt ?? ""}`}
      store={props.store}
      host={host}
      {...(props.prompt ? { prompt: props.prompt } : {})}
      onFolder={setCwd}
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
      // The created session opens by itself (AppStore.createSession).
      onCreate={(payload) => {
        if (background) return startInBackground(props.store, host.id, payload, persona);
        const ref = props.store.personaRef(persona);
        return props.store.createSession(host.id, { ...payload, ...(ref ? { persona: ref } : {}) });
      }}
    />
  );
}
