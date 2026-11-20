import { useState } from "react";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors.ts";
import type { AppStore, HostView } from "@/lib/app-store";
import { ActionButton, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";

/**
 * The host's switch for sessions without permission prompts. Off until a person turns it on,
 * with a confirmation that names the host; turning it off asks nothing. Hidden on a daemon that
 * predates the switch.
 */
export function BypassSwitch(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const allowed = host.hostInfo?.allowBypassPermissions;
  if (allowed === undefined) return null;
  const set = async (allow: boolean) => {
    setRefused(null);
    try {
      // Turning it on is signed by the person's device when the host has one enrolled (#3507); off asks nothing.
      const made = allow ? await store.approval.bypassPayload(host.id) : null;
      if (made?.kind === "declined") return;
      const result = await store.hostRequest(
        host.id,
        "host.bypass",
        made?.payload ?? { allow: false, confirm: true },
      );
      if (!result.ok) {
        setRefused(refusalText(result.code, result.message, t, result));
        return;
      }
      await store.reloadHostInfo(host.id);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Panel title={t("hostPage.bypassTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.bypassHint")}</p>
      <p className="text-sm">{t(allowed ? "hostPage.bypassOn" : "hostPage.bypassOff")}</p>
      {refused !== null && <InlineNotice tone="error">{refused}</InlineNotice>}
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
