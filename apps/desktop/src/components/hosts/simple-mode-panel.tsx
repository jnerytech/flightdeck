import { Lock } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import type { UiMode } from "@/lib/simple-mode";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

const MODES: readonly UiMode[] = ["full", "simple"];

/**
 * The host's page in full mode: what this host opens in and whether it is locked, the default
 * mode, the lock, and a way to open it in simple mode now. Only someone in full mode sees it;
 * hidden on a daemon that predates simple mode.
 */
export function SimpleModePanel(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const [locking, setLocking] = useState(false);
  const ui = host.hostInfo?.ui;
  if (!ui) return null;
  const locked = ui.locked === true;
  const modeName = (mode: UiMode) =>
    t(mode === "simple" ? "hostPage.modeSimple" : "hostPage.modeFull");

  const setDefault = async (mode: UiMode) => {
    if (mode === ui.mode) return;
    // The default is for the next person: the one changing it keeps the view they have.
    store.setUiChoice(host.id, store.uiMode(host.id).mode);
    if (await store.setHostUi(host.id, { mode })) {
      store.success(t("hostPage.simpleDefaultDone", { mode: modeName(mode), host: host.name }));
    }
  };
  const setLocked = async (next: boolean) => {
    if (await store.setHostUi(host.id, { locked: next })) {
      store.success(
        t(next ? "hostPage.simpleLockedDone" : "hostPage.simpleUnlockedDone", { host: host.name }),
      );
    }
  };

  return (
    <Panel title={t("hostPage.simpleTitle")}>
      <p className="text-muted-foreground text-xs">{t("hostPage.simpleHint")}</p>
      <div className="stack-hair">
        <p className="inline-flex items-center gap-1.5 text-sm">
          {t("hostPage.simpleStateMode", { mode: modeName(ui.mode) })}
        </p>
        <p className="inline-flex items-center gap-1.5 text-sm">
          {locked && <Lock aria-hidden="true" className="size-3.5" />}
          {t(locked ? "hostPage.simpleStateLockOn" : "hostPage.simpleStateLockOff")}
        </p>
      </div>
      <div role="radiogroup" aria-label={t("hostPage.simpleDefaultLabel")} className="seg-control">
        {MODES.map((mode) => (
          <label key={mode} className="seg-option">
            <input
              type="radio"
              name={`ui-default-${host.id}`}
              checked={ui.mode === mode}
              disabled={locked}
              aria-label={modeName(mode)}
              onChange={() => void setDefault(mode)}
            />
            <span aria-hidden="true">{modeName(mode)}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm">
          <Switch
            aria-label={t("hostPage.simpleLock")}
            checked={locked}
            onCheckedChange={(next) => (next ? setLocking(true) : void setLocked(false))}
          />
          {t("hostPage.simpleLock")}
        </span>
        {!locked && (
          <ActionButton variant="outline" onClick={() => store.setUiChoice(host.id, "simple")}>
            {t("hostPage.simpleUse")}
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
            void setLocked(true);
          }}
        />
      )}
    </Panel>
  );
}
