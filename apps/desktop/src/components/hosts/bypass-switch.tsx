import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/**
 * The host's switch for sessions without permission prompts. Off until a person turns it on,
 * with a confirmation that names the host; turning it off asks nothing. Hidden on a daemon that
 * predates the switch.
 */
export function BypassSwitch(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [asking, setAsking] = useState(false);
  const allowed = host.hostInfo?.allowBypassPermissions;
  if (allowed === undefined) return null;
  const set = async (allow: boolean) => {
    await store.hostCommand(host.id, "host.bypass", { allow, confirm: true });
    await store.reloadHostInfo(host.id);
  };
  return (
    <Panel title={t("hostPage.bypassTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.bypassHint")}</p>
      <p className="text-sm">{t(allowed ? "hostPage.bypassOn" : "hostPage.bypassOff")}</p>
      <div>
        {allowed ? (
          <ActionButton variant="outline" onClick={() => set(false)}>
            {t("hostPage.bypassTurnOff")}
          </ActionButton>
        ) : (
          <ActionButton variant="outline" onClick={() => setAsking(true)}>
            {t("hostPage.bypassAllow")}
          </ActionButton>
        )}
      </div>
      {asking && (
        <ConfirmDialog
          destructive
          message={t("hostPage.bypassAllowMessage", { host: host.name })}
          confirmLabel={t("hostPage.bypassAllow")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void set(true);
          }}
        />
      )}
    </Panel>
  );
}
