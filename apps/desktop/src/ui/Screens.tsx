import { useEffect, useState } from "react";
import { LoadingState } from "@/components/layout/states";
import { type AppState, type AppStore, type HostView, sessionKey } from "../lib/app-store.ts";
import type { HubRow } from "../lib/hub.ts";
import { basename } from "../lib/paths.ts";
import type { Route } from "../lib/router.ts";
import { emptySession } from "../lib/session-state.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { hasFeature } from "../lib/version.ts";
import { BoardView } from "./BoardView.tsx";
import { CardDetail } from "./CardDetail.tsx";
import { CostsPage } from "./CostsPage.tsx";
import { ExternalView } from "./ExternalView.tsx";
import { HistoryList } from "./HistoryList.tsx";
import { draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { HostPage } from "./HostPage.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { ProjectsPage } from "./ProjectsPage.tsx";
import { SessionsHub } from "./SessionsHub.tsx";
import { SessionView } from "./SessionView.tsx";
import { Settings } from "./Settings.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { TranscriptReader } from "./TranscriptReader.tsx";
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
      costUsd={costUsd}
    />
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
    <div className="welcome">
      {props.empty && <p>Adicione um host com o endereço e o token do flightdeckd.</p>}
      <HostForm
        {...(props.draft
          ? {
              initial: props.draft,
              notice: "Este link veio de fora do app. Confira os dados antes de salvar.",
            }
          : {})}
        error={error}
        onSubmit={(draft) => void submit(draft)}
      />
    </div>
  );
}

/** The screen of a route. `go` opens another one (the history keeps this one). */
export function Screen(props: {
  route: Route;
  store: AppStore;
  state: AppState;
  theme: ThemeMode;
  go(route: Route): void;
}) {
  const { route, store, state, go } = props;
  const hostOf = (id: string) => state.hosts.find((h) => h.id === id);
  const hub = <SessionsHub store={store} state={state} onOpen={(row) => go(rowRoute(row))} />;
  // Screens that ask their host for data on opening wait for it to be online: a route can come
  // before the connection (a deep link at start-up).
  const waiting = hostToWait(route);
  const waitHost = waiting ? hostOf(waiting) : undefined;
  // A host removed while its screen was open: back to the hub.
  if (waiting && state.hostsLoaded && !waitHost) return hub;
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
      return hub;
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
      return host ? <NewSession store={store} host={host} /> : hub;
    }
    case "external":
      return (
        <ExternalView
          key={`${route.host}/${route.claudeSessionId}`}
          store={store}
          state={state}
          hostId={route.host}
          hostName={hostOf(route.host)?.name ?? route.host}
          claudeSessionId={route.claudeSessionId}
          onResumed={() => go({ name: "home" })}
        />
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
      return (
        <HistoryList
          key={route.host}
          store={store}
          hostId={route.host}
          hostName={hostOf(route.host)?.name ?? route.host}
          onOpen={(claudeSessionId) =>
            go({ name: "reader", target: { hostId: route.host, claudeSessionId } })
          }
        />
      );
    case "host": {
      const host = hostOf(route.host);
      if (!host) return hub;
      return (
        <HostPage
          key={host.id}
          store={store}
          host={host}
          onRename={(name) => store.renameHost(host.id, name)}
          onReconnect={() => void store.reconnectHost(host.id)}
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
          onOpenBoard={(projectId) => go({ name: "board", host: route.host, projectId })}
          onOpenWorkflows={({ id, name }) =>
            go({ name: "workflows", host: route.host, projectId: id, projectName: name })
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
  return hub;
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
