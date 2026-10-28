import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
import { emptySession } from "../lib/session-state.ts";
import { HostForm } from "./HostForm.tsx";
import { NewSessionForm } from "./NewSessionForm.tsx";
import { SessionView } from "./SessionView.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function App({ store }: { store: AppStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [addingHost, setAddingHost] = useState(false);

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
          onSubmit={(host) => {
            setAddingHost(false);
            void store.addHost(host);
          }}
        />
      </div>
    );
  } else if (selectedHost && sessionId) {
    const summary = selectedHost.sessions.find((s) => s.id === sessionId);
    const session = state.sessions[sessionKey(selectedHost.id, sessionId)] ?? emptySession();
    main = (
      <SessionView
        title={summary?.name ?? basename(summary?.cwd ?? session.cwd ?? sessionId)}
        session={session}
        actions={store}
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
          store.select(hostId, id);
        }}
        onRemoveHost={(id) => void store.removeHost(id)}
        onAddHost={() => setAddingHost(true)}
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
