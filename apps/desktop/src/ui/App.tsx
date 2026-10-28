import { parsePairingLink } from "@flightdeck/protocol";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
import { emptySession } from "../lib/session-state.ts";
import { draftFromLink, draftUrl, type HostDraft, HostForm } from "./HostForm.tsx";
import { HostPage } from "./HostPage.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { SessionView } from "./SessionView.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function App({ store }: { store: AppStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [addingHost, setAddingHost] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  /** Request clicked in the "Precisa de você" queue: the session view scrolls to its card. */
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  /** Host whose page is open, if any. */
  const [hostPage, setHostPage] = useState<string | null>(null);
  const pageHost = state.hosts.find((h) => h.id === hostPage);
  /** Form prefilled by a deep link; the key remounts the form with the new values. */
  const [linked, setLinked] = useState<{ draft: HostDraft; key: number } | null>(null);

  // Links come from anywhere: they only prefill the form, saving needs the user's click.
  useEffect(
    () =>
      store.onDeepLink((url) => {
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

  const selectedHost = state.hosts.find((h) => h.id === state.selected?.hostId);
  const sessionId = state.selected?.sessionId;

  let main: ReactNode;
  if (addingHost || state.hosts.length === 0) {
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
  } else if (pageHost) {
    main = (
      <HostPage
        key={pageHost.id}
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
    main = <p className="muted welcome">Escolha uma sessão ou crie uma nova.</p>;
  }

  return (
    <div className="app">
      <Sidebar
        state={state}
        onSelect={(hostId, id) => {
          setAddingHost(false);
          setHostPage(null);
          store.select(hostId, id);
        }}
        onRemoveHost={(id) => void store.removeHost(id)}
        onAddHost={() => setAddingHost(true)}
        onOpenHost={(hostId) => {
          setAddingHost(false);
          setHostPage(hostId);
        }}
        onOpenRequest={(item) => {
          setAddingHost(false);
          setHostPage(null);
          setFocusRequest(item.requestId);
          store.select(item.hostId, item.sessionId);
        }}
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
    </div>
  );
}
