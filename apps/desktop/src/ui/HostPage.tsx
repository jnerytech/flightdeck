import { useState } from "react";
import type { HostView } from "../lib/app-store.ts";

/** One host: what `host.info` reports, heartbeat latency, and rename / reconnect / remove. */
export function HostPage(props: {
  host: HostView;
  onRename(name: string): void;
  onReconnect(): void;
  onRemove(): void;
}) {
  const { host } = props;
  const [name, setName] = useState(host.name);
  const info = host.hostInfo;
  return (
    <section className="host-page card">
      <h2>{host.name}</h2>
      <p className="muted">{host.url}</p>
      {info ? (
        <ul className="host-info">
          <li>{`${info.os} · ${info.arch}`}</li>
          <li>{`flightdeckd ${info.daemonVersion}`}</li>
          <li>{`claude: ${info.claudeVersion ?? "não informado"}`}</li>
          <li>{`sessões ativas: ${info.activeSessions}`}</li>
          <li>{`no ar há ${info.uptimeSec} s`}</li>
          <li>{`latência: ${host.latencyMs === null ? "—" : `${host.latencyMs} ms`}`}</li>
        </ul>
      ) : (
        <p className="muted">informações indisponíveis</p>
      )}
      {info?.apiKeySanitized === false && (
        <p className="warning">
          O consumo deste host pode estar indo para crédito de API: o daemon repassa a chave ao
          Claude (allowApiKey).
        </p>
      )}
      <div className="form">
        <label>
          Nome do host
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" onClick={() => name.trim() && props.onRename(name.trim())}>
          Salvar nome
        </button>
      </div>
      <div className="session-controls">
        <button type="button" onClick={props.onReconnect}>
          Reconectar
        </button>
        <button type="button" className="danger" onClick={props.onRemove}>
          Remover host
        </button>
      </div>
    </section>
  );
}
