import { BookOpen, MessagesSquare } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { SplitView } from "@/components/layout/split-view";
import { EmptyState, LoadingState } from "@/components/layout/states";
import {
  type AppState,
  type AppStore,
  type HostView,
  type PendingItem,
  sessionKey,
} from "../lib/app-store.ts";
import type { Density } from "../lib/density.ts";
import type { HubRow } from "../lib/hub.ts";
import { basename } from "../lib/paths.ts";
import type { Route } from "../lib/router.ts";
import { emptySession } from "../lib/session-state.ts";
import { isBusy } from "../lib/status.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { hasFeature } from "../lib/version.ts";
import { ActionsPage } from "./ActionsPage.tsx";
import { AgentPage } from "./AgentPage.tsx";
import { AutoApprovalsPage } from "./AutoApprovalsPage.tsx";
import { AutomationsPage } from "./AutomationsPage.tsx";
import { BoardView } from "./BoardView.tsx";
import { CardDetail } from "./CardDetail.tsx";
import { CheckpointsButton } from "./Checkpoints.tsx";
import { ConnectionsPage } from "./ConnectionsPage.tsx";
import { CostsPage } from "./CostsPage.tsx";
import { ExternalView } from "./ExternalView.tsx";
import { HistoryList } from "./HistoryList.tsx";
import { draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { HostPage } from "./HostPage.tsx";
import { NeedsYou } from "./NeedsYou.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { ProjectsPage } from "./ProjectsPage.tsx";
import { QuotaPanel } from "./QuotaPanel.tsx";
import { SessionsHub } from "./SessionsHub.tsx";
import { SessionTabs } from "./SessionTabs.tsx";
import { SessionView } from "./SessionView.tsx";
import { Settings } from "./Settings.tsx";
import { SnippetsPage } from "./SnippetsPage.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { TerminalPage } from "./TerminalPage.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";
import { VaultPage } from "./VaultPage.tsx";
import { WorkflowsPage } from "./WorkflowsPage.tsx";

/** The host a route's screen loads from when it opens, if any. */
function hostToWait(route: Route): string | null {
  switch (route.name) {
    case "reader":
      return route.target.hostId;
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
  const session = state.sessions[sessionKey(hostId, sessionId)] ?? emptySession();
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
    >
      <SessionView
        t={store.i18n.t}
        nowMs={store.now()}
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
        <p className="text-muted-foreground text-sm">{props.store.i18n.t("welcome.addHost")}</p>
      )}
      <HostForm
        {...(props.draft
          ? {
              initial: props.draft,
              notice: "Este link veio de fora do app. Confira os dados antes de salvar.",
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
  const { t } = store.i18n;
  // A host removed while its screen was open: back to the hub.
  const waiting = hostToWait(props.route);
  const removed =
    waiting !== null && state.hostsLoaded && !state.hosts.some((h) => h.id === waiting);
  const route: Route = removed ? { name: "hub" } : props.route;
  const detail = routeScreen({ ...props, route });
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
        labels={{ resize: t("hub.resize") }}
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
          <QuotaPanel store={store} state={state} />
        </div>
      }
      onClose={() => go({ name: "hub" })}
      labels={{ resize: t("hub.resize") }}
      initialWidth={store.listWidth()}
      onResize={(width) => store.setListWidth(width)}
    />
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
    return (
      <div className="p-6">
        <LoadingState label={label} />
      </div>
    );
  }

  if (route.name === "settings") {
    return (
      <Settings
        store={store}
        state={state}
        settings={state.settings}
        onCloseToTray={(enabled) => void store.setCloseToTray(enabled)}
        onAutostart={(enabled) => void store.setAutostart(enabled)}
        onGlobalShortcut={(text) => void store.setGlobalShortcut(text)}
        appUpdate={state.appUpdate}
        onCheckUpdate={() => void store.checkAppUpdate()}
        onNotifyUpdates={(enabled) => store.setNotifyUpdates(enabled)}
        theme={props.theme}
        onTheme={(mode) => store.theme.setMode(mode)}
        density={props.density}
        onDensity={(density) => store.density.set(density)}
        lang={store.i18n.lang}
        onLang={(next) => store.i18n.setLang(next)}
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
    case "snippets":
      return <SnippetsPage store={store} state={state} />;
    case "connections":
      return <ConnectionsPage store={store} state={state} go={go} connect={route.connect} />;
    case "costs":
      return (
        <CostsPage
          store={store}
          state={state}
          onOpenSession={(hostId, session) =>
            go(
              session.sessionId
                ? { name: "session", host: hostId, id: session.sessionId }
                : { name: "reader", target: { hostId, claudeSessionId: session.claudeSessionId } },
            )
          }
        />
      );
    case "vault":
      return <VaultPage store={store} state={state} />;
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
      return host ? <NewSession store={store} host={host} /> : null;
    }
    case "external":
      return (
        <SessionTabs
          key={`${route.host}/${route.claudeSessionId}`}
          store={store}
          hostId={route.host}
          claudeSessionId={route.claudeSessionId}
          enabled={hasFeature(hostOf(route.host)?.hostInfo?.features, "review", false)}
        >
          <ExternalView
            store={store}
            state={state}
            hostId={route.host}
            hostName={hostOf(route.host)?.name ?? route.host}
            claudeSessionId={route.claudeSessionId}
            onResumed={() => go({ name: "home" })}
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
          state={state}
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
          state={state}
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
  if (selectedHost) return <NewSession store={store} host={selectedHost} />;
  return null;
}

/** The new-session form of a host; the created session opens. */
function NewSession(props: { store: AppStore; host: HostView }) {
  const { host } = props;
  return (
    <NewSessionForm
      key={host.id}
      host={host}
      // The created session opens by itself (AppStore.createSession).
      onCreate={(payload) => void props.store.createSession(host.id, payload)}
    />
  );
}
