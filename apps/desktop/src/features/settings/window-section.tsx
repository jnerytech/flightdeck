import { useId, useSyncExternalStore } from "react";
import type { T } from "@/i18n/index.ts";
import type { AppStore } from "@/lib/app-store.ts";
import { Panel } from "@/shared/layout/index.ts";
import { check } from "./appearance-section.tsx";
import type { Settings as SettingsState } from "./index.ts";

/** The Window block: close to the tray, start with Windows, the setup checklist and the teleport preview. */
export function WindowSection(
  props: Readonly<{
    store: AppStore;
    settings: SettingsState;
    t: T;
    onCloseToTray(enabled: boolean): void;
    onAutostart(enabled: boolean): void;
  }>,
) {
  const { store, settings, t, onCloseToTray, onAutostart } = props;
  const autostartHint = useId();
  const setupHidden = useSyncExternalStore(store.setup.subscribe, () => store.setup.hidden);
  return (
    <Panel title={t("prefs.window")}>
      <label className={check}>
        <input
          type="checkbox"
          checked={settings.closeToTray}
          onChange={(e) => onCloseToTray(e.target.checked)}
        />
        {t("prefs.closeToTray")}
      </label>
      <label className={check}>
        <input
          type="checkbox"
          checked={settings.autostart}
          disabled={!settings.autostartSupported}
          aria-describedby={settings.autostartSupported ? undefined : autostartHint}
          onChange={(e) => onAutostart(e.target.checked)}
        />
        {t("prefs.autostart")}
      </label>
      {!settings.autostartSupported && (
        <small id={autostartHint} className="setting-hint">
          {t("prefs.unavailable")}
        </small>
      )}
      <label className={check}>
        <input
          type="checkbox"
          checked={!setupHidden}
          onChange={(e) => store.setup.setHidden(!e.target.checked)}
        />
        {t("setup.restore")}
      </label>
      <label className={check}>
        <input
          type="checkbox"
          checked={settings.teleportPreview}
          onChange={(e) => store.settings.setTeleportPreview(e.target.checked)}
        />
        {t("teleportUi.preview")}
      </label>
    </Panel>
  );
}
