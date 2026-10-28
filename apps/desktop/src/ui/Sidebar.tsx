import { type AppState, needsYou, type PendingItem } from "../lib/app-store.ts";
import type { ConnectionStatus } from "../lib/host-connection.ts";
import { basename } from "../lib/paths.ts";
import { StatusBadge } from "./StatusBadge.tsx";

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  online: "online",
  offline: "offline",
  connecting: "reconectando",
  unauthorized: "token recusado",
};

/** Hosts with their connection state and, inside each, the sessions with a status badge. */
export function Sidebar(props: {
  state: AppState;
  onSelect(hostId: string, sessionId: string | null): void;
  onRemoveHost(hostId: string): void;
  onAddHost(): void;
  onOpenRequest(item: PendingItem): void;
}) {
  const { state } = props;
  const queue = needsYou(state);
  return (
    <nav className="sidebar">
      {queue.length > 0 && (
        <section className="needs-you">
          <h3>Precisa de você ({queue.length})</h3>
          <ul>
            {queue.map((item) => (
              <li key={`${item.hostId}/${item.requestId}`}>
                <button type="button" onClick={() => props.onOpenRequest(item)}>
                  {`${item.hostName} · ${item.sessionName}: ${item.toolName}`}
                </button>
              </li>
            ))}
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
            <strong>{host.name}</strong>
            <button
              type="button"
              className="icon"
              aria-label={`Nova sessão em ${host.name}`}
              onClick={() => props.onSelect(host.id, null)}
            >
              +
            </button>
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
    </nav>
  );
}
