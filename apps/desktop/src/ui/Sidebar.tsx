import { type AppState, needsYou, type PendingItem } from "../lib/app-store.ts";
import type { ConnectionStatus } from "../lib/host-connection.ts";
import { basename } from "../lib/paths.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { StatusBadge } from "./StatusBadge.tsx";

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  online: "online",
  offline: "offline",
  connecting: "reconectando",
  unauthorized: "token recusado",
  incompatible: "incompatível: atualize o daemon",
};

/** Hosts with their connection state and, inside each, the sessions with a status badge. */
export function Sidebar(props: {
  state: AppState;
  onSelect(hostId: string, sessionId: string | null): void;
  onRemoveHost(hostId: string): void;
  onAddHost(): void;
  onOpenRequest(item: PendingItem): void;
  onRespond(item: PendingItem, decision: "allow" | "deny"): void;
  onOpenHost(hostId: string): void;
  onOpenSettings(): void;
  onOpenSearch(): void;
  onOpenHistory(hostId: string): void;
  onOpenProjects(hostId: string): void;
  onOpenHub(): void;
}) {
  const { state } = props;
  const queue = needsYou(state);
  return (
    <nav className="sidebar">
      <button
        type="button"
        className="hub-link"
        aria-label="Abrir Sessões"
        onClick={props.onOpenHub}
      >
        Sessões
      </button>
      {queue.length > 0 && (
        <section className="needs-you">
          <h3>Precisa de você ({queue.length})</h3>
          <ul>
            {queue.map((item) => {
              const label = `${item.hostName} · ${item.sessionName}: ${item.toolName}`;
              return (
                <li key={`${item.hostId}/${item.requestId}`}>
                  <button type="button" onClick={() => props.onOpenRequest(item)}>
                    {label}
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`${item.gate ? "Aprovar" : "Permitir"} ${label}`}
                    onClick={() => props.onRespond(item, "allow")}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`${item.gate ? "Recusar" : "Negar"} ${label}`}
                    onClick={() => props.onRespond(item, "deny")}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {state.hosts.map((host) => (
        <div key={host.id} className="host">
          <div className="host-header">
            <span
              className={`dot dot-${host.status}`}
              role="img"
              aria-label={`${host.name}: ${CONNECTION_LABELS[host.status]}`}
            />
            <button
              type="button"
              className="host-name"
              aria-label={`Abrir host ${host.name}`}
              onClick={() => props.onOpenHost(host.id)}
            >
              {host.name}
            </button>
            {host.hostInfo?.apiKeySanitized === false && (
              <span
                className="badge badge-warn"
                role="img"
                aria-label={`${host.name}: chave de API repassada`}
              >
                ⚠
              </span>
            )}
            {host.hostInfo && host.hostInfo.daemonVersion !== APP_VERSION && (
              <span
                className="badge badge-warn"
                role="img"
                aria-label={`${host.name}: versão diferente`}
                title={`flightdeckd ${host.hostInfo.daemonVersion}, app ${APP_VERSION}`}
              >
                ≠
              </span>
            )}
            {/* An incompatible host offers nothing but its page and removal. */}
            {host.status !== "incompatible" && (
              <>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Histórico de ${host.name}`}
                  onClick={() => props.onOpenHistory(host.id)}
                >
                  🕘
                </button>
                {hasFeature(host.hostInfo?.features, "workflows", true) && (
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Projetos de ${host.name}`}
                    onClick={() => props.onOpenProjects(host.id)}
                  >
                    ▦
                  </button>
                )}
                <button
                  type="button"
                  className="icon"
                  aria-label={`Nova sessão em ${host.name}`}
                  onClick={() => props.onSelect(host.id, null)}
                >
                  +
                </button>
              </>
            )}
            <button
              type="button"
              className="icon"
              aria-label={`Remover ${host.name}`}
              onClick={() => props.onRemoveHost(host.id)}
            >
              ×
            </button>
          </div>
          <ul>
            {host.sessions.map((s) => {
              const active =
                state.selected?.hostId === host.id && state.selected.sessionId === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={active ? "session-item active" : "session-item"}
                    onClick={() => props.onSelect(host.id, s.id)}
                  >
                    <span className="session-name">{s.name ?? basename(s.cwd)}</span>
                    <span className="muted">{basename(s.cwd)}</span>
                    <StatusBadge status={s.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button type="button" className="add-host" onClick={props.onAddHost}>
        Adicionar outro host
      </button>
      <button type="button" className="add-host" onClick={props.onOpenSearch}>
        Buscar no histórico (Ctrl+K)
      </button>
      <button type="button" className="add-host" onClick={props.onOpenSettings}>
        Configurações
      </button>
    </nav>
  );
}
