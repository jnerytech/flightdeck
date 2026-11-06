import { useEffect } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";

/**
 * The host's switch for keeping the computer awake while sessions run (issue #163): on unless the
 * person turns it off, with what it does, whether it holds right now and, when nothing can hold,
 * why. Hidden on a daemon that predates it.
 */
export function KeepAwakePanel(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const status = host.hostInfo?.keepAwake;
  // The host says "holding" while a session runs: read it again when one starts, changes or ends.
  const activity = host.sessions.map((s) => `${s.id}:${s.status}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `activity` is the trigger
  useEffect(() => {
    if (status !== undefined) void store.reloadHostInfo(host.id);
  }, [store, host.id, activity]);
  if (status === undefined) return null;
  const set = async (enabled: boolean) => {
    await store.hostCommand(host.id, "host.keepAwake", { enabled });
    await store.reloadHostInfo(host.id);
  };
  return (
    <Panel title={t("hostPage.keepAwakeTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.keepAwakeHint")}</p>
      <p className="text-sm">
        {t(status.enabled ? "hostPage.keepAwakeOn" : "hostPage.keepAwakeOff")}
      </p>
      {status.held && <p className="text-sm">{t("hostPage.keepAwakeHeld")}</p>}
      {status.enabled && status.reason && (
        <p className="text-sm">{t(`hostPage.keepAwakeReason.${status.reason}`)}</p>
      )}
      <div>
        <ActionButton variant="outline" onClick={() => set(!status.enabled)}>
          {t(status.enabled ? "hostPage.keepAwakeTurnOff" : "hostPage.keepAwakeTurnOn")}
        </ActionButton>
      </div>
    </Panel>
  );
}
