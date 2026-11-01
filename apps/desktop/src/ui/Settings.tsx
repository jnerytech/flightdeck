import { memo, type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WatchSettingsSection } from "@/components/watch/watch-settings-section";
import { useStoreSlice } from "@/lib/use-store";
import { LANGS, type Lang, type T } from "../i18n/index.ts";
import type { AppStore, AppUpdateState, Settings as SettingsState } from "../lib/app-store.ts";
import type { Density } from "../lib/density.ts";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from "../lib/terminal-view.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { hasFeature } from "../lib/version.ts";
import { BudgetsSection } from "./BudgetsSection.tsx";
import { MessagingRulesSection } from "./MessagingRulesSection.tsx";

/** A setting: its label on the left and its control on the right; the label focuses the control. */
function SettingRow(props: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
    </div>
  );
}

const SETTINGS_KEYS = ["hosts", "budgets", "projects"] as const;

/**
 * App preferences: close-to-tray (on by default), start with Windows (off by default) and the
 * global shortcut that opens the search (Ctrl+Alt+F by default).
 */
export const Settings = memo(function Settings(props: {
  store: AppStore;
  settings: SettingsState;
  onCloseToTray(enabled: boolean): void;
  onAutostart(enabled: boolean): void;
  onGlobalShortcut(text: string): void;
  appUpdate: AppUpdateState;
  onCheckUpdate(): void;
  onNotifyUpdates(enabled: boolean): void;
  /** Light, dark or the system's (phase 10). */
  theme: ThemeMode;
  onTheme(mode: ThemeMode): void;
  /** The list rows' height (phase 10). */
  density: Density;
  onDensity(density: Density): void;
  /** pt-BR or English (phase 10). */
  lang: Lang;
  onLang(lang: Lang): void;
  t: T;
}) {
  const { store } = props;
  const state = useStoreSlice(store, SETTINGS_KEYS);
  const { t } = props;
  const terminalFont = useSyncExternalStore(
    props.store.terminalFont.subscribe,
    () => props.store.terminalFont.value,
  );
  const { settings } = props;
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  /** A checkbox with its sentence on its right. */
  const check = "flex items-center gap-2 text-sm";
  return (
    <Page title={t("prefs.title")}>
      <div className="flex max-w-2xl flex-col gap-5">
        <Panel title={t("prefs.appearance")}>
          <SettingRow label={t("settings.theme")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="w-44"
                value={props.theme}
                onChange={(e) => props.onTheme(e.target.value as ThemeMode)}
              >
                <option value="system">{t("settings.themes.system")}</option>
                <option value="light">{t("settings.themes.light")}</option>
                <option value="dark">{t("settings.themes.dark")}</option>
              </NativeSelect>
            )}
          </SettingRow>
          <SettingRow label={t("settings.density")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="w-44"
                value={props.density}
                onChange={(e) => props.onDensity(e.target.value as Density)}
              >
                <option value="compact">{t("settings.densities.compact")}</option>
                <option value="comfortable">{t("settings.densities.comfortable")}</option>
              </NativeSelect>
            )}
          </SettingRow>
          <SettingRow label={t("settings.terminalFont")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                className="w-44"
                min={TERMINAL_FONT_MIN}
                max={TERMINAL_FONT_MAX}
                value={terminalFont}
                onChange={(e) => props.store.terminalFont.set(Number(e.target.value))}
              />
            )}
          </SettingRow>
          <SettingRow label={t("settings.language")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="w-44"
                value={props.lang}
                onChange={(e) => props.onLang(e.target.value as Lang)}
              >
                {LANGS.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(`languages.${lang}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </SettingRow>
        </Panel>
        <Panel title={t("clients.title")}>
          <p className="text-muted-foreground text-sm">{t("clients.settingsHint")}</p>
          <div>
            <Button variant="outline" onClick={() => props.store.router.push({ name: "clients" })}>
              {t("clients.manageShort")}
            </Button>
          </div>
        </Panel>
        <Panel title={t("prefs.window")}>
          <label className={check}>
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => props.onCloseToTray(e.target.checked)}
            />
            {t("prefs.closeToTray")}
          </label>
          <label className={check}>
            <input
              type="checkbox"
              checked={settings.autostart}
              disabled={!settings.autostartSupported}
              onChange={(e) => props.onAutostart(e.target.checked)}
            />
            {t("prefs.autostart")}
          </label>
          {!settings.autostartSupported && (
            <small className="text-muted-foreground text-xs">{t("prefs.unavailable")}</small>
          )}
        </Panel>
        {settings.updaterSupported && (
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
            <Button variant="outline" className="self-start" onClick={props.onCheckUpdate}>
              {t("prefs.checkNow")}
            </Button>
            {props.appUpdate.upToDate && (
              <p className="text-muted-foreground text-sm">{t("prefs.upToDate")}</p>
            )}
          </Panel>
        )}
        <Panel title={t("prefs.shortcut")}>
          {settings.shortcutProblem && <InlineNotice>{settings.shortcutProblem}</InlineNotice>}
          <Form variant="inline" onSubmit={() => props.onGlobalShortcut(shortcut)}>
            <Field
              label={t("prefs.shortcut")}
              help={t("prefs.shortcutNote")}
              error={settings.shortcutError}
            >
              {(control) => (
                <Input
                  {...control}
                  className="w-56"
                  value={shortcut}
                  disabled={shortcutOff}
                  onChange={(e) => setShortcut(e.target.value)}
                />
              )}
            </Field>
            <FormActions
              submit={t("prefs.saveShortcut")}
              disabled={shortcutOff || shortcut === settings.globalShortcut}
              disabledReason={
                shortcutOff ? t("prefs.shortcutUnavailable") : t("prefs.shortcutUnchanged")
              }
            />
          </Form>
        </Panel>
        {state.hosts
          // Budgets came with the costs (phase 8).
          .filter((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false))
          .map((h) => (
            <BudgetsSection
              key={h.id}
              store={props.store}
              hostId={h.id}
              hostName={h.name}
              budgets={state.budgets[h.id] ?? []}
            />
          ))}
        {state.hosts
          .filter((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "watch", false))
          .map((h) => (
            <WatchSettingsSection
              key={`watch/${h.id}`}
              store={props.store}
              hostId={h.id}
              hostName={h.name}
              projects={state.projects[h.id] ?? []}
            />
          ))}
        {state.hosts
          .filter(
            (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
          )
          .map((h) => (
            <MessagingRulesSection
              key={`messaging/${h.id}`}
              store={props.store}
              hostId={h.id}
              hostName={h.name}
            />
          ))}
      </div>
    </Page>
  );
});
