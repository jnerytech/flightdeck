import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/**
 * The host's page in full mode: open this host in simple mode, make it the host's default and lock
 * it. Only someone in full mode sees it; hidden on a daemon that predates simple mode.
 */
export function SimpleModePanel(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [locking, setLocking] = useState(false);
  const ui = host.hostInfo?.ui;
  if (!ui) return null;
  const locked = ui.locked === true;
  const simpleDefault = ui.mode === "simple";
  return (
    <Panel title={t("hostPage.simpleTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.simpleHint")}</p>
      <div className="flex flex-wrap gap-2">
        {!locked && (
          <ActionButton variant="outline" onClick={() => store.setUiChoice(host.id, "simple")}>
            {t("hostPage.simpleUse")}
          </ActionButton>
        )}
        {!locked && (
          <ActionButton
            variant="outline"
            onClick={() => {
              // The default is for the next person: the one changing it keeps the view they have.
              store.setUiChoice(host.id, store.uiMode(host.id).mode);
              return store.setHostUi(host.id, { mode: simpleDefault ? "full" : "simple" });
            }}
          >
            {t(simpleDefault ? "hostPage.simpleDefaultFull" : "hostPage.simpleDefault")}
          </ActionButton>
        )}
        {locked ? (
          <ActionButton
            variant="outline"
            onClick={() => store.setHostUi(host.id, { locked: false })}
          >
            {t("hostPage.simpleUnlock")}
          </ActionButton>
        ) : (
          <ActionButton variant="outline" onClick={() => setLocking(true)}>
            {t("hostPage.simpleLock")}
          </ActionButton>
        )}
      </div>
      {locking && (
        <ConfirmDialog
          message={t("hostPage.simpleLockMessage", { host: host.name })}
          confirmLabel={t("hostPage.simpleLockConfirm")}
          onCancel={() => setLocking(false)}
          onConfirm={() => {
            setLocking(false);
            void store.setHostUi(host.id, { locked: true });
          }}
        />
      )}
    </Panel>
  );
}
