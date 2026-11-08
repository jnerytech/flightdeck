import type { CommandPayload } from "@flightdeck/protocol";
import { BookOpen, MessagesSquare } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { HostOfflineBanner } from "@/components/hosts/host-offline-banner";
import { CacheTimer } from "@/components/hub/cache-timer";
import { Page } from "@/components/layout/page";
import { SplitView } from "@/components/layout/split-view";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { PersonaSwitch } from "@/components/personas/persona-switch";
import { UntrustedNotice } from "@/components/projects/untrusted-notice";
import { EarlierTurns } from "@/components/session/earlier-turns";
import { Button } from "@/components/ui/button";
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
import { type HubRow, isOver } from "../lib/hub.ts";
import { actionOfRoute, endMeasure } from "../lib/measures.ts";
import { newSessionHost } from "../lib/new-session-host.ts";
import { basename, holdsFolder } from "../lib/paths.ts";
import type { Route } from "../lib/router.ts";
import { isBusy } from "../lib/status.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { useSessionCost } from "../lib/use-session-cost.ts";
import { useSessionState } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";
import { ActivityBoard } from "./ActivityBoard.tsx";
import { CheckpointsButton } from "./Checkpoints.tsx";
import type { TopSession } from "./CostsPage.tsx";
import { ExternalView } from "./ExternalView.tsx";
import { FirstRun } from "./FirstRun.tsx";
import { FolderPicker } from "./FolderPicker.tsx";
import { HistoryList } from "./HistoryList.tsx";
import { draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { lazyScreen } from "./lazy-screen.ts";
import { NeedsYou } from "./NeedsYou.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { QuotaPanel } from "./QuotaPanel.tsx";
import { RecapPanel } from "./RecapPanel.tsx";
import { SessionsHub } from "./SessionsHub.tsx";
import { SessionTabs } from "./SessionTabs.tsx";
import { SessionView } from "./SessionView.tsx";
import { SetupPage } from "./SetupPage.tsx";
import { StartScreen } from "./StartScreen.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { TerminalPage } from "./TerminalPage.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";

/**
 * The screens the first one does not need are loaded when their route opens (`bundle:budget`
 * keeps the entry chunk under its limit; scripts/test/screens-lazy.test.ts lists them).
 */
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
const HomePage = lazyScreen(() => import("./HomePage.tsx"), "HomePage");
const HostPage = lazyScreen(() => import("./HostPage.tsx"), "HostPage");
const PersonasPage = lazyScreen(() => import("./PersonasPage.tsx"), "PersonasPage");
const PluginsPage = lazyScreen(() => import("./PluginsPage.tsx"), "PluginsPage");
const PreviewPage = lazyScreen(() => import("./PreviewPage.tsx"), "PreviewPage");
const ProjectsPage = lazyScreen(() => import("./ProjectsPage.tsx"), "ProjectsPage");
const ProjectsOverview = lazyScreen(() => import("./ProjectsOverview.tsx"), "ProjectsOverview");
const ProjectPage = lazyScreen(() => import("./ProjectPage.tsx"), "ProjectPage");
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
    case "project":
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
  if (row.origin === "terminal" && !isOver(row.state)) {
    return { name: "external", host: row.hostId, claudeSessionId: id };
  }
  // A background session: its screen when the host knows its Claude session, else the hub.
  if (row.origin === "background") {
    return id ? { name: "external", host: row.hostId, claudeSessionId: id } : { name: "hub" };
  }
  return { name: "reader", target: { hostId: row.hostId, claudeSessionId: id } };
}

/** The folder picker the composer opens to mention a file or folder of the host; none once it is gone. */
const pathPicker =
  (store: AppStore, host: HostView | undefined) => (done: (path: string | null) => void) =>
    host && (
      <FolderPicker
        store={store}
        host={host}
        files={hasFeature(host.hostInfo?.features, "fs.files", false)}
        onPick={(path) => done(path)}
        onClose={() => done(null)}
      />
    );

/** A managed session's conversation; selecting it subscribes to its full event stream. */
function ManagedSession(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    hostId: string;
    sessionId: string;
    focus: string | null;
    /** Opens the host's page (the mode menu links to the bypass switch there). */
    go(route: Route): void;
  }>,
) {
  const { store, state, hostId, sessionId } = props;
  const host = state.hosts.find((h) => h.id === hostId);
  useEffect(() => {
    if (state.selected?.hostId !== hostId || state.selected.sessionId !== sessionId) {
      store.select(hostId, sessionId);
    }
  }, [store, state.selected, hostId, sessionId]);
  const summary = host?.sessions.find((s) => s.id === sessionId);
  const session = useSessionState(store, sessionKey(hostId, sessionId));
  const opencode = summary?.runtime === "opencode";
  const openCodeModels = useOpenCodeModels(store, hostId, opencode);
  // Estimated cost of the session, once its claudeSessionId is known (phase 8): from its own
  // events, else from the Sessões list.
  const claudeId =
    session.claudeSessionId ??
    state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
  const withCosts = hasFeature(host?.hostInfo?.features, "costs", false);
  const status = session.status;
  const pinned = claudeId ? state.meta[`${hostId}/${claudeId}`]?.pinned === true : false;
  const cwd = summary?.cwd ?? session.cwd ?? "";
  // The project the folder belongs to, where the person can read what it would load and trust it.
  const owner = state.projects[hostId]?.find((p) => holdsFolder(p.path, cwd));
  const canFork = hasFeature(host?.hostInfo?.features, "checkpoints", false);
  // Stable between renders: the finished messages of a long conversation are not drawn again.
  const pin = useMemo(
    () =>
      claudeId
        ? { pinned, toggle: () => void store.setMeta(hostId, claudeId, { pinned: !pinned }) }
        : undefined,
    [store, hostId, claudeId, pinned],
  );
  const fork = useMemo(
    () =>
      claudeId && canFork
        ? () =>
            void store
              .hostCommand(hostId, "session.fork", {
                claudeSessionId: claudeId,
                cwd,
                open: "flightdeck",
              })
              .then((result) => {
                if (result?.sessionId) {
                  store.router.push({ name: "session", host: hostId, id: result.sessionId });
                }
              })
        : undefined,
    [store, hostId, claudeId, canFork, cwd],
  );
  const costUsd = useSessionCost(store, hostId, claudeId, withCosts, status);
  return (
    <SessionTabs
      store={store}
      hostId={hostId}
      viewKey={sessionKey(hostId, sessionId)}
      // Issue #107: a shell in the session's folder, where the host opens one for a session.
      {...(store.embeddedTerminal(hostId) &&
      hasFeature(host?.hostInfo?.features, "terminal.session", false)
        ? { terminal: { session: sessionId } }
        : {})}
      claudeSessionId={claudeId}
      // This page's message box takes a review handed over from Changes.
      reviewToComposer
      // Phase 39: these tabs read Claude Code's transcript, and OpenCode sessions stay out of messaging.
      enabled={!opencode && hasFeature(host?.hostInfo?.features, "review", false)}
      messagingId={
        !opencode && hasFeature(host?.hostInfo?.features, "messaging", false) ? sessionId : null
      }
      telemetry={!opencode && hasFeature(host?.hostInfo?.features, "telemetry", false)}
      trace={!opencode && hasFeature(host?.hostInfo?.features, "trace", false)}
      files={!opencode && hasFeature(host?.hostInfo?.features, "file.list", false)}
    >
      <SessionView
        t={store.i18n.t}
        nowMs={store.now()}
        {...(hasFeature(host?.hostInfo?.features, "snippets", false)
          ? { prompts: store.promptSnippets(hostId, summary?.cwd ?? session.cwd ?? "") }
          : {})}
        title={summary?.name ?? basename(summary?.cwd ?? session.cwd ?? sessionId)}
        scrollKey={sessionKey(hostId, sessionId)}
        composerFill={state.composerFill[sessionKey(hostId, sessionId)] ?? null}
        onComposerFilled={() => store.takeComposerFill(sessionKey(hostId, sessionId))}
        session={session}
        actions={store}
        cache={
          <CacheTimer store={store} since={summary?.status === "idle" ? summary.updatedAt : null} />
        }
        {...(pin ? { pin } : {})}
        {...(fork ? { fork } : {})}
        {...(summary?.runtime ? { runtime: summary.runtime } : {})}
        {...(openCodeModels ? { models: openCodeModels } : {})}
        {...(claudeId && !opencode && hasFeature(host?.hostInfo?.features, "review", false)
          ? {
              // #1133: End first asks about the files the session's checkout did not commit.
              uncommitted: async () => {
                const found = await store.hostRequest(hostId, "changes.get", {
                  target: `session:${claudeId}`,
                });
                return found.ok ? found.data.files.length : 0;
              },
              onCommitFirst: () => void store.sessionViews.select("changes"),
            }
          : {})}
        settings={hasFeature(host?.hostInfo?.features, "session.settings", false)}
        effort={hasFeature(host?.hostInfo?.features, "session.effort", false)}
        onOpenHostSettings={() => props.go({ name: "host", host: hostId })}
        {...(host?.hostInfo?.allowBypassPermissions === true
          ? { bypass: { host: host.name } }
          : {})}
        images={hasFeature(host?.hostInfo?.features, "session.images", false)}
        pickPath={pathPicker(store, host)}
        focusRequestId={props.focus}
        assist={{
          controller: store.assistant,
          kind: "prompt",
          fieldHostId: hostId,
          ...(cwd ? { cwd } : {}),
          openSettings: () => props.go({ name: "settings", section: "assistant" }),
        }}
        {...(session.resumedFrom
          ? {
              earlier: (
                <EarlierTurns store={store} hostId={hostId} claudeSessionId={session.resumedFrom} />
              ),
            }
          : {})}
        recap={
          <>
            <UntrustedNotice
              store={store}
              hostId={hostId}
              announced={hasFeature(host?.hostInfo?.features, "projectTrust", false)}
              cwd={cwd}
              sessionId={sessionId}
              {...(summary?.trustStale ? { stale: true } : {})}
              {...(owner
                ? {
                    onReview: () =>
                      store.router.push({ name: "project", host: hostId, projectId: owner.id }),
                  }
                : {})}
            />
            {claudeId && (
              <RecapPanel
                store={store}
                hostId={hostId}
                claudeSessionId={claudeId}
                stamp={status}
                {...(owner?.path || cwd ? { libraryPath: owner?.path || cwd } : {})}
              />
            )}
          </>
        }
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
    const result = await props.store.testAndAddHost({
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
        <FirstRun onCopy={(text) => void props.store.copyText(text)} />
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
  const waiting = hostToWait(props.route);
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
  if (hostToWait(route) && state.hosts.find((h) => h.id === hostId)?.status !== "online") {
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
      initialWidth={store.listWidth()}
      onResize={(width) => store.setListWidth(width)}
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
                store.select(firstHost.id, null);
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
    onAutoUpdate: (enabled: boolean) => store.setAutoUpdate(enabled),
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
  const waiting = hostToWait(route);
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
          onReconnect={() => void store.reconnectHost(waitHost.id)}
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
      {...(store.embeddedTerminal(route.host)
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
              prompts: store.promptSnippets(
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
      onRename={(name) => store.renameHost(host.id, name)}
      onReconnect={() => void store.reconnectHost(host.id)}
      onPairAgain={(input) => store.pairAgain(host.id, input)}
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
        void store.removeHost(host.id);
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
        <ProjectsOverview
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
    case "conversations":
      return <ConversationsPage store={store} go={go} />;
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

/** Phase 39: the host's OpenCode models, for an OpenCode session's live switch; null until known. */
function useOpenCodeModels(store: AppStore, hostId: string, opencode: boolean): string[] | null {
  const [models, setModels] = useState<string[] | null>(null);
  useEffect(() => {
    if (!opencode) return;
    let live = true;
    void store.hostRequest(hostId, "runtime.models", { runtime: "opencode" }).then((result) => {
      if (live) setModels(result.ok ? result.data.models.map((m) => m.id) : []);
    });
    return () => {
      live = false;
    };
  }, [store, hostId, opencode]);
  return opencode ? models : null;
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
  const persona = picked ?? props.store.clientScope().defaultPersona(host.id, cwd);
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
      // The created session opens by itself (AppStore.createSession).
      onCreate={(payload) => {
        if (payload.runtime === "opencode") return props.store.createSession(host.id, payload);
        if (background) return startInBackground(props.store, host.id, payload, persona);
        const ref = props.store.personaRef(persona);
        return props.store.createSession(host.id, { ...payload, ...(ref ? { persona: ref } : {}) });
      }}
    />
  );
}
