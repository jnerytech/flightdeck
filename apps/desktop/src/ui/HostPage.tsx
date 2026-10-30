import type { HooksStatusResult } from "@flightdeck/protocol";
import { useEffect, useId, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
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
  const t = useT();
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
              <span>{t("hostPage.incompatible")}</span>
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
        <Panel title={t("hostPage.info")}>
          {info ? (
            <ul className="flex flex-col gap-1 text-sm">
              <li>{`${info.os} · ${info.arch}`}</li>
              <li>{t("hostPage.daemon", { version: info.daemonVersion })}</li>
              <li>{t("hostPage.app", { version: APP_VERSION })}</li>
              {info.daemonVersion !== APP_VERSION && (
                <li className="text-status-needs-you">{t("hostPage.differs")}</li>
              )}
              <li>
                {t("hostPage.claude", { version: info.claudeVersion ?? t("hostPage.unknown") })}
              </li>
              <li>{t("hostPage.active", { n: info.activeSessions })}</li>
              <li>{t("hostPage.uptime", { n: info.uptimeSec })}</li>
              <li>
                {t("hostPage.latency", {
                  value: host.latencyMs === null ? "—" : `${host.latencyMs} ms`,
                })}
              </li>
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("hostPage.unavailable")}</p>
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
          <section aria-label={t("hostPage.hooks")}>
            <Panel title={t("hostPage.hooks")}>
              <p className="text-sm">
                {hooks ? HOOK_LABELS[hooks.status] : t("hostPage.hooksAsking")}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirming("install")}>
                  {t("hostPage.install")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirming("uninstall")}>
                  {t("hostPage.uninstall")}
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
                ? t("hostPage.installMessage", { path: settingsPath })
                : t("hostPage.uninstallMessage", { path: settingsPath })
            }
            confirmLabel={
              confirming === "install" ? t("hostPage.install") : t("hostPage.uninstall")
            }
            destructive={confirming === "uninstall"}
            onConfirm={() => void apply()}
            onCancel={() => setConfirming(null)}
          />
        )}
        <Panel title={t("hostPage.host")}>
          <label className="flex flex-col gap-1 text-sm" htmlFor={nameId}>
            {t("hostPage.nameLabel")}
            <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => name.trim() && props.onRename(name.trim())}
          >
            {t("hostPage.saveName")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onReconnect}>
              {t("hostPage.reconnect")}
            </Button>
            <Button variant="destructive" onClick={() => setRemoving(true)}>
              {t("hostPage.remove")}
            </Button>
          </div>
          {removing && (
            <ConfirmDialog
              message={t("sidebar.removeConfirm", { host: host.name })}
              confirmLabel={t("hostPage.remove")}
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
