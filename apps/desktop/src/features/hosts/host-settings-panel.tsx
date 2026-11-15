import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { HarnessTemplatesSection } from "@/features/harness/ui.ts";
import { useT } from "@/i18n/context";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { Panel, Stack } from "@/shared/layout/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { MaintenanceSection } from "../maintenance/ui.ts";
import { TelemetrySection } from "../telemetry/ui.ts";
import { AllowedFolders } from "./allowed-folders.tsx";
import { BypassSwitch } from "./bypass-switch.tsx";
import { DaemonUpdate } from "./daemon-update.tsx";
import { GithubPanel } from "./github-panel.tsx";
import { HostAutoUpdate } from "./host-auto-update.tsx";
import { HostLogs } from "./host-logs.tsx";
import { HostPausePanel } from "./host-pause-panel.tsx";
import { HostTerminal } from "./host-terminal.tsx";
import { HostWorktrees } from "./host-worktrees.tsx";
import { KeepAwakePanel } from "./keep-awake-panel.tsx";
import { ResumePanel } from "./resume-panel.tsx";
import { SimpleModePanel } from "./simple-mode-panel.tsx";
import { SleepSetting } from "./sleep-setting.tsx";

/**
 * The Settings tab of a host: its panels in order, each one shown for a host that has its
 * feature, and Reconnect / Remove at the end. The Hooks panel comes from the page, which also
 * holds its dialog.
 */
export function HostSettingsPanel(
  props: Readonly<{
    store: AppStore;
    host: HostView;
    hooksSection: ReactNode;
    onReconnect(): void;
    onRemove(): void;
    onOpenAutoApprovals(): void;
  }>,
) {
  const t = useT();
  const { store, host } = props;
  const info = host.hostInfo;
  const [removing, setRemoving] = useState(false);
  return (
    <Stack gap={4}>
      <AllowedFolders store={store} host={host} />
      <BypassSwitch store={store} host={host} />
      <SleepSetting store={store} host={host} />
      <SimpleModePanel store={store} host={host} />
      <KeepAwakePanel store={store} host={host} />
      <HostPausePanel store={store} host={host} />
      <ResumePanel store={store} host={host} />
      {host.status === "online" && hasFeature(info?.features, "github", false) && (
        <GithubPanel store={store} host={host} />
      )}
      <HostWorktrees store={store} host={host} />
      <HostAutoUpdate store={store} host={host} />
      <DaemonUpdate store={store} host={host} />
      {props.hooksSection}
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
      {host.status === "online" && hasFeature(info?.features, "harnessTemplates", false) && (
        <HarnessTemplatesSection store={store} hostId={host.id} />
      )}
      <HostLogs store={store} host={host} />
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
    </Stack>
  );
}
