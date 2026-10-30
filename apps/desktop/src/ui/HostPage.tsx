import type { HooksStatusResult } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DaemonUpdate } from "./DaemonUpdate.tsx";
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
  const nameId = useId();
  const info = host.hostInfo;
  const { store } = props;
  const [hooks, setHooks] = useState<HooksStatusResult | null>(null);
  const [confirming, setConfirming] = useState<"install" | "uninstall" | null>(null);
  const [removing, setRemoving] = useState(false);
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
    <Page title={host.name} subtitle={host.url}>
      <div className="flex max-w-3xl flex-col gap-5">
        {host.status === "incompatible" && (
          <InlineNotice>
            <span className="flex flex-col gap-1">
              <span>incompatível: atualize o daemon</span>
              <span>{host.incompatibility}</span>
              <span>
                No host, com o binário desta versão do app ({APP_VERSION}):{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  flightdeckd update --from &lt;binário novo&gt;
                </code>
              </span>
            </span>
          </InlineNotice>
        )}
        {(hasFeature(info?.features, "quota", false) ||
          hasFeature(info?.features, "costs", false)) && (
          <UsagePanel
            store={store}
            hostId={host.id}
            online={host.status === "online"}
            costs={hasFeature(info?.features, "costs", false)}
          />
        )}
        <Panel title="Informações">
          {info ? (
            <ul className="flex flex-col gap-1 text-sm">
              <li>{`${info.os} · ${info.arch}`}</li>
              <li>{`flightdeckd ${info.daemonVersion}`}</li>
              <li>{`app ${APP_VERSION}`}</li>
              {info.daemonVersion !== APP_VERSION && (
                <li className="text-status-needs-you">versão diferente da do app</li>
              )}
              <li>{`claude: ${info.claudeVersion ?? "não informado"}`}</li>
              <li>{`sessões ativas: ${info.activeSessions}`}</li>
              <li>{`no ar há ${info.uptimeSec} s`}</li>
              <li>{`latência: ${host.latencyMs === null ? "—" : `${host.latencyMs} ms`}`}</li>
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">informações indisponíveis</p>
          )}
        </Panel>
        <DaemonUpdate store={store} host={host} />
        {info?.apiKeySanitized === false && (
          <InlineNotice>
            O consumo deste host pode estar indo para crédito de API: o daemon repassa a chave ao
            Claude (allowApiKey).
          </InlineNotice>
        )}
        {showHooks && (
          <section aria-label="Hooks do Claude Code">
            <Panel title="Hooks do Claude Code">
              <p className="text-sm">{hooks ? HOOK_LABELS[hooks.status] : "consultando…"}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirming("install")}>
                  Instalar hooks
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirming("uninstall")}>
                  Remover hooks
                </Button>
              </div>
            </Panel>
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
            confirmLabel={confirming === "install" ? "Instalar hooks" : "Remover hooks"}
            destructive={confirming === "uninstall"}
            onConfirm={() => void apply()}
            onCancel={() => setConfirming(null)}
          />
        )}
        <Panel title="Host">
          <label className="flex flex-col gap-1 text-sm" htmlFor={nameId}>
            Nome do host
            <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => name.trim() && props.onRename(name.trim())}
          >
            Salvar nome
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onReconnect}>
              Reconectar
            </Button>
            <Button variant="destructive" onClick={() => setRemoving(true)}>
              Remover host
            </Button>
          </div>
          {removing && (
            <ConfirmDialog
              message={`Remover o host ${host.name}? As sessões dele saem da lista; o daemon continua rodando.`}
              confirmLabel="Remover host"
              destructive
              onConfirm={() => {
                setRemoving(false);
                props.onRemove();
              }}
              onCancel={() => setRemoving(false)}
            />
          )}
        </Panel>
      </div>
    </Page>
  );
}
