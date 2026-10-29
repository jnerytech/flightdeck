import type { SessionMeta } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppState, AppStore } from "../lib/app-store.ts";
import {
  type HubFilter,
  type HubRow,
  hubGroups,
  hubRows,
  ORIGIN_LABELS,
  STATE_LABELS,
  sessionLineText,
} from "../lib/hub.ts";
import { when } from "./GlobalSearch.tsx";
import { QuotaPanel } from "./QuotaPanel.tsx";

const ALL: HubFilter = {
  text: "",
  host: "",
  origin: "",
  state: "",
  pinnedOnly: false,
  showArchived: false,
};

/**
 * The main screen: every session of every online host (managed, opened in the terminal, or from
 * the history), grouped by project and sorted by last activity, with filters and a small menu.
 */
export function SessionsHub(props: {
  store: AppStore;
  state: AppState;
  onOpen(row: HubRow): void;
}) {
  const { store, state } = props;
  const [filter, setFilter] = useState<HubFilter>(ALL);
  const [renaming, setRenaming] = useState<HubRow | null>(null);
  const [name, setName] = useState("");
  // Reload when hosts come online or sessions come and go.
  const signature = state.hosts.map((h) => `${h.id}:${h.status}:${h.sessions.length}`).join();
  useEffect(() => {
    if (signature) void store.refreshHub();
  }, [store, signature]);

  const groups = hubGroups(hubRows(state), filter);
  const set = (patch: Partial<HubFilter>) => setFilter({ ...filter, ...patch });
  const meta = (row: HubRow, patch: Partial<SessionMeta>) =>
    void store.setMeta(row.hostId, row.claudeSessionId as string, patch);

  return (
    <section className="hub">
      <QuotaPanel store={store} state={state} />
      <h2>Sessões</h2>
      <div className="row filters">
        <input
          aria-label="Filtrar sessões"
          placeholder="Filtrar"
          value={filter.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <select
          aria-label="Host"
          value={filter.host}
          onChange={(e) => set({ host: e.target.value })}
        >
          <option value="">Todos os hosts</option>
          {state.hosts
            .filter((h) => h.status !== "incompatible")
            .map((h) => (
              <option key={h.id} value={h.name}>
                {h.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Origem"
          value={filter.origin}
          onChange={(e) => set({ origin: e.target.value as HubFilter["origin"] })}
        >
          <option value="">Todas as origens</option>
          <option value="flightdeck">Flightdeck</option>
          <option value="terminal">Terminal</option>
          <option value="history">Histórico</option>
        </select>
        <select
          aria-label="Estado"
          value={filter.state}
          onChange={(e) => set({ state: e.target.value as HubFilter["state"] })}
        >
          <option value="">Todos os estados</option>
          <option value="running">Rodando</option>
          <option value="needs_you">Precisa de você</option>
          <option value="idle">Ociosa</option>
          <option value="ended">Encerrada</option>
        </select>
        <button
          type="button"
          aria-pressed={filter.pinnedOnly}
          onClick={() => set({ pinnedOnly: !filter.pinnedOnly })}
        >
          Só fixadas
        </button>
        <button
          type="button"
          aria-pressed={filter.showArchived}
          onClick={() => set({ showArchived: !filter.showArchived })}
        >
          Mostrar arquivadas
        </button>
      </div>
      {renaming && (
        <div className="row">
          <input aria-label="Novo nome" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            onClick={() => {
              meta(renaming, { name: name.trim() || null });
              setRenaming(null);
            }}
          >
            Salvar nome
          </button>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.key} aria-label={`Projeto ${group.name}`} className="hub-group">
          <h3>{group.name}</h3>
          <ul>
            {group.rows.map((row) => (
              <li key={row.key} aria-label={row.title}>
                <button type="button" onClick={() => props.onOpen(row)}>
                  {row.title}
                </button>
                <span className="muted">
                  {[
                    row.hostName,
                    ORIGIN_LABELS[row.origin],
                    STATE_LABELS[row.state],
                    when(row.lastActivity),
                  ].join(" · ")}
                </span>
                <SessionLineText text={sessionLineText(row.summary, store.now())} />
                {row.controllable && <span className="badge">controlável</span>}
                {row.claudeSessionId && (
                  <span className="menu">
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Renomear ${row.title}`}
                      onClick={() => {
                        setRenaming(row);
                        setName(row.title);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`${row.pinned ? "Desafixar" : "Fixar"} ${row.title}`}
                      onClick={() => meta(row, { pinned: !row.pinned })}
                    >
                      📌
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`${row.archived ? "Desarquivar" : "Arquivar"} ${row.title}`}
                      onClick={() => meta(row, { archived: !row.archived })}
                    >
                      🗄
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Copiar comando de ${row.title}`}
                      onClick={() =>
                        void store.copyText(`flightdeckd claude --resume ${row.claudeSessionId}`)
                      }
                    >
                      ⧉
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

/** "Pedido: … · rodando Bash" under the row, when the daemon sends one. */
function SessionLineText({ text }: { text: string }) {
  return text ? <span className="session-line">{text}</span> : null;
}
