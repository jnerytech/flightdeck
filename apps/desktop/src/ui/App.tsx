import { parsePairingLink } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AppStore, type PendingItem, sessionKey } from "../lib/app-store.ts";
import type { HubRow } from "../lib/hub.ts";
import type { PaletteTarget } from "../lib/palette.ts";
import { basename } from "../lib/paths.ts";
import { emptySession } from "../lib/session-state.ts";
import { hasFeature } from "../lib/version.ts";
import { BoardView } from "./BoardView.tsx";
import { CardDetail } from "./CardDetail.tsx";
import { CostsPage } from "./CostsPage.tsx";
import { ExternalView } from "./ExternalView.tsx";
import { GlobalSearch } from "./GlobalSearch.tsx";
import { HistoryList } from "./HistoryList.tsx";
import { draftFromLink, draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { HostPage } from "./HostPage.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { ProjectsPage } from "./ProjectsPage.tsx";
import { SessionsHub } from "./SessionsHub.tsx";
import { SessionView } from "./SessionView.tsx";
import { Settings } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TerminalButton } from "./TerminalButton.tsx";
import { type ReaderTarget, TranscriptReader } from "./TranscriptReader.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { WorkflowsPage } from "./WorkflowsPage.tsx";

export function App({ store }: { store: AppStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [addingHost, setAddingHost] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  /** Request clicked in the "Precisa de você" queue: the session view scrolls to its card. */
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  /** Host whose page is open, if any. */
  const [hostPage, setHostPage] = useState<string | null>(null);
  const pageHost = state.hosts.find((h) => h.id === hostPage);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Transcript open in the read-only reader, if any. */
  const [reading, setReading] = useState<ReaderTarget | null>(null);
  const readingHost = state.hosts.find((h) => h.id === reading?.hostId);
  /** Host whose history list is open, if any. */
  const [historyHost, setHistoryHost] = useState<string | null>(null);
  const historyHostView = state.hosts.find((h) => h.id === historyHost);
  /** Host whose Projects screen is open, if any. */
  const [projectsHost, setProjectsHost] = useState<string | null>(null);
  const projectsHostView = state.hosts.find((h) => h.id === projectsHost);
  /** Board open, and the card open on top of it. */
  const [boardOf, setBoardOf] = useState<{ hostId: string; projectId: string } | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  /** Project whose Workflows screen is open, if any. */
  const [workflowsOf, setWorkflowsOf] = useState<{
    hostId: string;
    projectId: string;
    name: string;
  } | null>(null);
  /** The Sessões screen, opened from the sidebar (it is also what shows when nothing else does). */
  const [hubOpen, setHubOpen] = useState(false);
  /** The Custos screen (phase 8). */
  const [costsOpen, setCostsOpen] = useState(false);
  /** A live session opened in the terminal, shown with its requests and message box. */
  const [external, setExternal] = useState<{ hostId: string; claudeSessionId: string } | null>(
    null,
  );
  const externalHost = state.hosts.find((h) => h.id === external?.hostId);
  /** Leaving for any other screen closes the board, hub and external ones. */
  const closeBoard = () => {
    setProjectsHost(null);
    setBoardOf(null);
    setOpenCard(null);
    setWorkflowsOf(null);
    setHubOpen(false);
    setCostsOpen(false);
    setExternal(null);
  };
  /** From the Sessões screen: the conversation, the live external view or the reader. */
  const openRow = (row: HubRow) => {
    closeBoard();
    setReading(null);
    setHistoryHost(null);
    setHostPage(null);
    const id = row.claudeSessionId as string;
    if (row.sessionId) store.select(row.hostId, row.sessionId);
    else if (row.origin === "terminal" && row.state !== "ended") {
      setExternal({ hostId: row.hostId, claudeSessionId: id });
    } else setReading({ hostId: row.hostId, claudeSessionId: id });
  };
  /** Form prefilled by a deep link; the key remounts the form with the new values. */
  const [linked, setLinked] = useState<{ draft: HostDraft; key: number } | null>(null);

  // Links come from anywhere: they only prefill the form, saving needs the user's click. A
  // request link (a notification click) only shows the request.
  useEffect(
    () =>
      store.onDeepLink((url) => {
        if (store.openRequestLink(url)) return;
        const parsed = parsePairingLink(url);
        if (!parsed.ok) {
          store.reportError(`Link de pareamento recusado: ${parsed.error}`);
          return;
        }
        const { url: wsUrl, name, token } = parsed.value;
        setLinked({ draft: draftFromLink(wsUrl, name, token), key: Date.now() });
        setAddingHost(true);
      }),
    [store],
  );

  const submitHost = async (draft: HostDraft) => {
    setHostError(null);
    const result = await store.testAndAddHost({
      name: draft.name,
      url: draftUrl(draft),
      token: draft.token,
    });
    if (result.ok) {
      setAddingHost(false);
      setLinked(null);
    } else setHostError(result.error);
  };

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, [store]);

  // The OS refused the global shortcut: show the warning where another one can be chosen.
  const shortcutProblem = state.settings.shortcutProblem;
  useEffect(() => {
    if (shortcutProblem) setSettingsOpen(true);
  }, [shortcutProblem]);

  // Inside the app only: as a global shortcut Ctrl+K would clash with browsers and VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  /** A request from the queue, the tray or a notification: its session, card or terminal view. */
  const openRequest = (item: PendingItem) => {
    closeBoard();
    if (item.gate) {
      // A gate opens its card, where it is answered inline.
      const { hostId } = item;
      setSettingsOpen(false);
      setAddingHost(false);
      void store.hostCommand(hostId, "card.get", { cardId: item.gate.cardId }).then((card) => {
        if (!card) return;
        setBoardOf({ hostId, projectId: card.projectId });
        setOpenCard(card.id);
      });
      return;
    }
    if (item.external) {
      setReading(null);
      setHostPage(null);
      setExternal({ hostId: item.hostId, claudeSessionId: item.sessionId });
      return;
    }
    setReading(null);
    setHistoryHost(null);
    setAddingHost(false);
    setSettingsOpen(false);
    setHostPage(null);
    setFocusRequest(item.requestId);
    store.select(item.hostId, item.sessionId);
  };
  const openRequestRef = useRef(openRequest);
  openRequestRef.current = openRequest;
  useEffect(() => store.onOpenRequest((item) => openRequestRef.current(item)), [store]);

  /** An entry or action of the Ctrl+K palette: its screen, or a terminal. */
  const goTo = (target: PaletteTarget) => {
    store.closeSearch();
    if (target.kind === "terminal") {
      void store.openInTerminal(target.hostId, target.target);
      return;
    }
    closeBoard();
    setReading(null);
    setHistoryHost(null);
    setAddingHost(false);
    setSettingsOpen(false);
    setHostPage(null);
    switch (target.kind) {
      case "session":
        store.select(target.hostId, target.sessionId);
        break;
      case "new-session":
        store.select(target.hostId, null);
        break;
      case "external":
        setExternal({ hostId: target.hostId, claudeSessionId: target.claudeSessionId });
        break;
      case "card":
        setBoardOf({ hostId: target.hostId, projectId: target.projectId });
        setOpenCard(target.cardId);
        break;
      case "board":
        setBoardOf({ hostId: target.hostId, projectId: target.projectId });
        break;
      case "workflows":
        setWorkflowsOf({ hostId: target.hostId, projectId: target.projectId, name: target.name });
        break;
      case "host":
        setHostPage(target.hostId);
        break;
      case "projects":
        setProjectsHost(target.hostId);
        break;
      case "settings":
        setSettingsOpen(true);
        break;
      case "costs":
        setCostsOpen(true);
        break;
    }
  };

  const selectedHost = state.hosts.find((h) => h.id === state.selected?.hostId);
  const sessionId = state.selected?.sessionId;
  // Estimated cost of the open managed session, once its claudeSessionId is known (phase 8):
  // from its own events, else from the Sessões list.
  const selectedSession = state.sessions[sessionKey(selectedHost?.id ?? "", sessionId ?? "")];
  const selectedClaudeId =
    selectedSession?.claudeSessionId ??
    state.hub[selectedHost?.id ?? ""]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
  const selectedStatus = selectedSession?.status;
  const withCosts = hasFeature(selectedHost?.hostInfo?.features, "costs", false);
  const [sessionCost, setSessionCost] = useState<number | null>(null);
  useEffect(() => {
    setSessionCost(null);
    if (!selectedHost?.id || !selectedClaudeId || !withCosts || !selectedStatus) return;
    void store
      .hostCommand(selectedHost.id, "costs.session", { claudeSessionId: selectedClaudeId })
      .then((r) => setSessionCost(r?.costUsd ?? null));
  }, [store, selectedHost?.id, selectedClaudeId, withCosts, selectedStatus]);

  let main: ReactNode;
  if (settingsOpen) {
    main = (
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
      />
    );
  } else if (addingHost || state.hosts.length === 0) {
    main = (
      <div className="welcome">
        {state.hosts.length === 0 && (
          <p>Adicione um host com o endereço e o token do flightdeckd.</p>
        )}
        <HostForm
          key={linked?.key ?? 0}
          {...(linked
            ? {
                initial: linked.draft,
                notice: "Este link veio de fora do app. Confira os dados antes de salvar.",
              }
            : {})}
          error={hostError}
          onSubmit={(draft) => void submitHost(draft)}
        />
      </div>
    );
  } else if (boardOf && openCard) {
    main = (
      <CardDetail
        key={openCard}
        store={store}
        state={state}
        hostId={boardOf.hostId}
        cardId={openCard}
        onBack={() => setOpenCard(null)}
      />
    );
  } else if (boardOf) {
    main = (
      <BoardView
        key={`${boardOf.hostId}/${boardOf.projectId}`}
        store={store}
        state={state}
        hostId={boardOf.hostId}
        projectId={boardOf.projectId}
        onOpenCard={setOpenCard}
      />
    );
  } else if (workflowsOf) {
    main = (
      <WorkflowsPage
        key={`${workflowsOf.hostId}/${workflowsOf.projectId}`}
        store={store}
        hostId={workflowsOf.hostId}
        projectId={workflowsOf.projectId}
        projectName={workflowsOf.name}
      />
    );
  } else if (projectsHostView) {
    main = (
      <ProjectsPage
        key={projectsHostView.id}
        store={store}
        hostId={projectsHostView.id}
        hostName={projectsHostView.name}
        rules={hasFeature(projectsHostView.hostInfo?.features, "rules", false)}
        onOpenBoard={(projectId) => setBoardOf({ hostId: projectsHostView.id, projectId })}
        onOpenWorkflows={({ id, name }) =>
          setWorkflowsOf({ hostId: projectsHostView.id, projectId: id, name })
        }
      />
    );
  } else if (external && externalHost) {
    main = (
      <ExternalView
        key={`${external.hostId}/${external.claudeSessionId}`}
        store={store}
        state={state}
        hostId={external.hostId}
        hostName={externalHost.name}
        claudeSessionId={external.claudeSessionId}
        onResumed={closeBoard}
      />
    );
  } else if (costsOpen) {
    main = (
      <CostsPage
        store={store}
        state={state}
        onOpenSession={(hostId, session) => {
          closeBoard();
          if (session.sessionId) store.select(hostId, session.sessionId);
          else setReading({ hostId, claudeSessionId: session.claudeSessionId });
        }}
      />
    );
  } else if (hubOpen) {
    main = <SessionsHub store={store} state={state} onOpen={openRow} />;
  } else if (reading && readingHost) {
    main = (
      <TranscriptReader
        key={`${reading.hostId}/${reading.claudeSessionId}/${reading.cursor ?? ""}`}
        store={store}
        target={reading}
        hostName={readingHost.name}
        onResumed={() => setReading(null)}
      />
    );
  } else if (historyHostView) {
    main = (
      <HistoryList
        key={historyHostView.id}
        store={store}
        hostId={historyHostView.id}
        hostName={historyHostView.name}
        onOpen={(claudeSessionId) => {
          setHistoryHost(null);
          setReading({ hostId: historyHostView.id, claudeSessionId });
        }}
      />
    );
  } else if (pageHost) {
    main = (
      <HostPage
        key={pageHost.id}
        store={store}
        host={pageHost}
        onRename={(name) => store.renameHost(pageHost.id, name)}
        onReconnect={() => void store.reconnectHost(pageHost.id)}
        onRemove={() => {
          setHostPage(null);
          void store.removeHost(pageHost.id);
        }}
      />
    );
  } else if (selectedHost && sessionId) {
    const summary = selectedHost.sessions.find((s) => s.id === sessionId);
    const session = state.sessions[sessionKey(selectedHost.id, sessionId)] ?? emptySession();
    main = (
      <SessionView
        title={summary?.name ?? basename(summary?.cwd ?? session.cwd ?? sessionId)}
        session={session}
        actions={store}
        focusRequestId={focusRequest}
        alwaysAllow={hasFeature(selectedHost.hostInfo?.features, "rules", false)}
        terminal={
          // Only once Claude Code named the session: there is nothing to resume before that.
          session.claudeSessionId && (
            <TerminalButton
              store={store}
              hostId={selectedHost.id}
              target={{
                cwd: summary?.cwd ?? session.cwd ?? "",
                claudeSessionId: session.claudeSessionId,
              }}
            />
          )
        }
        costUsd={sessionCost}
      />
    );
  } else if (selectedHost) {
    main = (
      <NewSessionForm
        key={selectedHost.id}
        host={selectedHost}
        onCreate={(payload) => void store.createSession(selectedHost.id, payload)}
      />
    );
  } else {
    main = <SessionsHub store={store} state={state} onOpen={openRow} />;
  }

  return (
    <div className="app">
      <UpdateBanner store={store} state={state} />
      <Sidebar
        state={state}
        onSelect={(hostId, id) => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(null);
          store.select(hostId, id);
        }}
        onRemoveHost={(id) => void store.removeHost(id)}
        onAddHost={() => {
          setSettingsOpen(false);
          setAddingHost(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => store.openSearch()}
        onOpenHistory={(hostId) => {
          closeBoard();
          setReading(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(null);
          setHistoryHost(hostId);
        }}
        onOpenHost={(hostId) => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(hostId);
        }}
        onOpenProjects={(hostId) => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(null);
          setProjectsHost(hostId);
        }}
        onRespond={(item, decision) =>
          item.gate
            ? void store.respondGate(
                item.hostId,
                item.gate,
                decision === "allow" ? "approve" : "reject",
              )
            : void store.respondTo(item.hostId, item.requestId, decision)
        }
        onOpenHub={() => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(null);
          setHubOpen(true);
        }}
        onOpenBudgets={() => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setHostPage(null);
          setSettingsOpen(true);
        }}
        onOpenCosts={() => {
          closeBoard();
          setReading(null);
          setHistoryHost(null);
          setAddingHost(false);
          setSettingsOpen(false);
          setHostPage(null);
          setCostsOpen(true);
        }}
        onOpenRequest={openRequest}
      />
      <main className="main">
        {state.error && (
          <div role="alert" className="error-banner">
            <span>{state.error}</span>
            <button type="button" onClick={() => store.clearError()}>
              Fechar
            </button>
          </div>
        )}
        {main}
      </main>
      {state.searchOpen && (
        <GlobalSearch
          state={state}
          store={store}
          costs={true}
          onGo={goTo}
          onSearch={(query) => void store.searchHistory(query)}
          onClose={() => store.closeSearch()}
          onOpenHit={(hit) => {
            store.closeSearch();
            closeBoard();
            setHistoryHost(null);
            setSettingsOpen(false);
            setAddingHost(false);
            setReading({
              hostId: hit.hostId,
              claudeSessionId: hit.claudeSessionId,
              cursor: hit.cursor,
              focusUuid: hit.uuid,
            });
          }}
        />
      )}
    </div>
  );
}
