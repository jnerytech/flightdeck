import type { HooksStatusResult } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { MaintenanceSection } from "./MaintenanceSection.tsx";
import { UsagePanel } from "./UsagePanel.tsx";

const HOOK_LABELS: Record<HooksStatusResult["status"], string> = {
  installed: "instalados",
  absent: "ausentes",
  outdated: "desatualizados (instale de novo)",
};

/**
 * One host: what `host.info` reports, heartbeat latency, the Claude Code hooks, and rename /
 * reconnect / remove.
 */
export function HostPage(props: {
  store: AppStore;
  host: HostView;
  onRename(name: string): void;
  onReconnect(): void;
  onRemove(): void;
}) {
  const { host } = props;
  const [name, setName] = useState(host.name);
  const info = host.hostInfo;
  const { store } = props;
  const [hooks, setHooks] = useState<HooksStatusResult | null>(null);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);
  useEffect(() => {
    if (host.status !== "online") return;
    void store.hostCommand(host.id, "hooks.status", {}).then(setHooks);
  }, [store, host.id, host.status]);
  const settingsPath = hooks?.settingsPath ?? "~/.claude/settings.json";
  // Hooks came with the central (phase 5): shown for older daemons, hidden when not announced.
  const showHooks = host.status !== "incompatible" && hasFeature(info?.features, "central", true);
  const apply = async () => {
    const kind = confirming;
    setConfirming(null);
    const result =
      kind === "install"
        ? await store.hostCommand(host.id, "hooks.install", { confirm: true })
        : await store.hostCommand(host.id, "hooks.uninstall", { confirm: true });
    if (result) setHooks(result);
  };
  return (
    <section className="host-page card">
      <h2>{host.name}</h2>
      <p className="muted">{host.url}</p>
      {host.status === "incompatible" && (
        <div className="warning">
          <p>incompatível: atualize o daemon</p>
          <p>{host.incompatibility}</p>
          <p>
            No host, com o binário desta versão do app ({APP_VERSION}):{" "}
            <code>flightdeckd update --from &lt;binário novo&gt;</code>
          </p>
        </div>
      )}
      {hasFeature(info?.features, "quota", false) && (
        <UsagePanel store={store} hostId={host.id} online={host.status === "online"} />
      )}
      {info ? (
        <ul className="host-info">
          <li>{`${info.os} · ${info.arch}`}</li>
          <li>{`flightdeckd ${info.daemonVersion}`}</li>
          <li>{`app ${APP_VERSION}`}</li>
          {info.daemonVersion !== APP_VERSION && (
            <li className="warning">versão diferente da do app</li>
          )}
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
      {showHooks && (
        <section aria-label="Hooks do Claude Code" className="hooks">
          <h3>Hooks do Claude Code</h3>
          <p>{hooks ? HOOK_LABELS[hooks.status] : "consultando…"}</p>
          <button type="button" onClick={() => setConfirming("install")}>
            Instalar hooks
          </button>
          <button type="button" onClick={() => setConfirming("uninstall")}>
            Remover hooks
          </button>
        </section>
      )}
      {host.status === "online" && hasFeature(info?.features, "maintenance", false) && (
        <MaintenanceSection store={store} hostId={host.id} />
      )}
      {confirming && (
        <ConfirmDialog
          message={
            confirming === "install"
              ? `Gravar os hooks do Flightdeck em ${settingsPath}? As outras chaves e hooks continuam, e uma cópia vai para settings.json.flightdeck-backup.`
              : `Remover os hooks do Flightdeck de ${settingsPath}? As outras entradas continuam.`
          }
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(null)}
        />
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
