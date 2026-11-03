import type { HooksStatusResult } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { AllowedFolders } from "@/components/hosts/allowed-folders";
import { BypassSwitch } from "@/components/hosts/bypass-switch";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { useHostLatency } from "@/lib/use-store";
import type { Key } from "../i18n/index.ts";
import type { AppStore, HostView } from "../lib/app-store.ts";
import type { HostNameError } from "../lib/host-name.ts";
import type { UsageHistoryTarget } from "../lib/usage-rows.ts";
import { APP_VERSION, hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DaemonUpdate } from "./DaemonUpdate.tsx";
import { HostTerminal } from "./HostTerminal.tsx";
import { MaintenanceSection } from "./MaintenanceSection.tsx";
import { RenameHostDialog } from "./RenameHostDialog.tsx";
import { TelemetrySection } from "./TelemetrySection.tsx";
import { UsagePanel } from "./UsagePanel.tsx";

const HOOK_LABELS = {
  installed: "hostPage.hooksInstalled",
  absent: "hostPage.hooksAbsent",
  outdated: "hostPage.hooksOutdated",
} as const satisfies Record<HooksStatusResult["status"], Key>;

/**
 * One host: what `host.info` reports, heartbeat latency, the Claude Code hooks, and rename /
 * reconnect / remove.
 */
export function HostPage(props: {
  store: AppStore;
  host: HostView;
  onRename(name: string): HostNameError | null;
  onReconnect(): void;
  onOpenAutoApprovals(): void;
  onOpenHistory(filter: UsageHistoryTarget): void;
  onRemove(): void;
}) {
  const t = useT();
  const { host } = props;
  const [renaming, setRenaming] = useState(false);
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
    <Page
      title={host.name}
      subtitle={host.url}
      actions={
        <Button variant="outline" onClick={() => setRenaming(true)}>
          {t("hostPage.rename")}
        </Button>
      }
    >
      <div className="flex max-w-3xl flex-col gap-5">
        {host.status === "incompatible" && (
          <InlineNotice>
            <span className="flex flex-col gap-1">
              <span>{t("hostPage.incompatible")}</span>
              <span>{host.incompatibility}</span>
              <span>
                {t("hostPage.incompatibleFix", { version: APP_VERSION })}{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  flightdeckd update --from {t("daemonUpdate.binary")}
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
            onOpenHistory={props.onOpenHistory}
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
              <HostLatency store={store} hostId={host.id} />
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("hostPage.unavailable")}</p>
          )}
        </Panel>
        <AllowedFolders store={store} host={host} />
        <BypassSwitch store={store} host={host} />
        <DaemonUpdate store={store} host={host} />
        {info?.apiKeySanitized === false && (
          <InlineNotice>{t("hostPage.apiKeyForwarded")}</InlineNotice>
        )}
        {showHooks && (
          <section aria-label={t("hostPage.hooks")}>
            <Panel title={t("hostPage.hooks")}>
              <p className="text-sm">
                {t(hooks ? HOOK_LABELS[hooks.status] : "hostPage.hooksAsking")}
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
        {host.status === "online" && hasFeature(info?.features, "telemetry", false) && (
          <TelemetrySection store={store} hostId={host.id} />
        )}
        {host.status === "online" && hasFeature(info?.features, "autoapprove", false) && (
          <Button variant="outline" className="self-start" onClick={props.onOpenAutoApprovals}>
            {t("autoApprovalsUi.open")}
          </Button>
        )}
        <HostTerminal store={store} host={host} />
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
        {renaming && (
          <RenameHostDialog
            name={host.name}
            onRename={props.onRename}
            onClose={() => setRenaming(false)}
          />
        )}
        <Panel title={t("hostPage.host")}>
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

/** The heartbeat latency line: the only part of the page that renders on a ping. */
function HostLatency(props: { store: AppStore; hostId: string }) {
  const t = useT();
  const latency = useHostLatency(props.store, props.hostId);
  return <li>{t("hostPage.latency", { value: latency === null ? "—" : `${latency} ms` })}</li>;
}
