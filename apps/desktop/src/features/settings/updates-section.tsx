import type { T } from "@/i18n/index.ts";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";
import type { AppUpdateState } from "../appupdate/index.ts";
import { check } from "./appearance-section.tsx";
import type { Settings as SettingsState } from "./index.ts";

/** The Updates block: whether to be told of an update, whether to install it, and a check on demand. */
export function UpdatesSection(
  props: Readonly<{
    settings: SettingsState;
    appUpdate: AppUpdateState;
    t: T;
    onCheckUpdate(): Promise<void> | void;
    onNotifyUpdates(enabled: boolean): void;
    onAutoUpdate(enabled: boolean): void;
  }>,
) {
  const { settings, appUpdate, t } = props;
  return (
    <Panel title={t("prefs.updates")}>
      <label className={check}>
        <input
          type="checkbox"
          aria-label={t("prefs.notifyUpdates")}
          checked={settings.notifyUpdates}
          onChange={(e) => props.onNotifyUpdates(e.target.checked)}
        />
        {t("prefs.notifyUpdates")}
      </label>
      <label className={check}>
        <input
          type="checkbox"
          aria-label={t("prefs.autoUpdate")}
          checked={settings.autoUpdate}
          onChange={(e) => props.onAutoUpdate(e.target.checked)}
        />
        {t("prefs.autoUpdate")}
      </label>
      <ActionButton variant="outline" className="self-start" onClick={props.onCheckUpdate}>
        {t("prefs.checkNow")}
      </ActionButton>
      {appUpdate.upToDate && (
        <output className="block text-muted-foreground text-sm">{t("prefs.upToDate")}</output>
      )}
      {appUpdate.error && (
        <p role="alert" className="text-status-needs-you">
          {appUpdate.error}
        </p>
      )}
    </Panel>
  );
}
