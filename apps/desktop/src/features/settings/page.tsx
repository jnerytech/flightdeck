import { memo, type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssistantSettings } from "@/features/assistant/ui.ts";
import { BackupAllPanel } from "@/features/backup/backup-all-panel.tsx";
import { BackupSchedulePanel } from "@/features/backup/backup-schedule-panel.tsx";
import { BudgetsSection } from "@/features/costs/ui.ts";
import { NotificationPrefs } from "@/features/notifications/ui.ts";
import type { CacheTtl } from "@/features/sessions/index.ts";
import type { Density, ThemeMode } from "@/features/shell/index.ts";
import { WatchSettingsSection } from "@/features/watch/watch-settings-section.tsx";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, NativeSelect, Page, Panel } from "@/shared/layout/index.ts";
import { LANGS, type Lang, type T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hostsWith } from "../../lib/version.ts";
import type { AppUpdateState } from "../appupdate/index.ts";
import { MessagingRulesSection } from "../messaging/rules-section.tsx";
import type { TabOrder } from "../tabs/index.ts";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from "../terminal/index.ts";
import { WebhooksSection } from "../webhook/ui.ts";
import { DiagnosticsPanel } from "./diagnostics-panel.tsx";
import type { Settings as SettingsState } from "./index.ts";
import { TerminalFontInput } from "./terminal-font-input.tsx";

/** A setting: its label on the left and its control on the right; the label focuses the control. */
function SettingRow(props: Readonly<{ label: string; children: (id: string) => ReactNode }>) {
  const id = useId();
  return (
    // One label column for every row, so the controls start on one line whatever the label (#588).
    <div className="setting-row">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
    </div>
  );
}

/** One block of the screen: its name on the rail, the words it answers to in the search, and its content. */
interface SettingsSection {
  id: string;
  label: string;
  words: string;
  node: ReactNode;
}

const SETTINGS_KEYS = ["hosts", "budgets", "projects"] as const;

/**
 * App preferences: close-to-tray (on by default), start with Windows (off by default) and the
 * global shortcut that opens the search (Ctrl+Alt+F by default).
 */
export const Settings = memo(function Settings(props: {
  store: AppStore;
  settings: SettingsState;
  /** The part to open on, by id. */
  section?: string;
  onCloseToTray(enabled: boolean): void;
  onAutostart(enabled: boolean): void;
  onGlobalShortcut(text: string): void;
  appUpdate: AppUpdateState;
  onCheckUpdate(): Promise<void> | void;
  onNotifyUpdates(enabled: boolean): void;
  onAutoUpdate(enabled: boolean): void;
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
  const terminalReader = useSyncExternalStore(
    props.store.terminalReader.subscribe,
    () => props.store.terminalReader.value,
  );
  const readerHint = useId();
  const fontHint = useId();
  const setupHidden = useSyncExternalStore(
    props.store.setup.subscribe,
    () => props.store.setup.hidden,
  );
  const cacheOn = useSyncExternalStore(
    props.store.cacheTimer.subscribe,
    () => props.store.cacheTimer.enabled,
  );
  const cacheTtl = useSyncExternalStore(
    props.store.cacheTimer.subscribe,
    () => props.store.cacheTimer.ttl,
  );
  const tabOrder = useSyncExternalStore(
    props.store.tabOrder.subscribe,
    () => props.store.tabOrder.value,
  );
  const { settings } = props;
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  /** A checkbox with its sentence on its right. */
  const check = "flex items-center gap-2 text-sm";
  // Budgets came with the costs (phase 8).
  const budgetHosts = hostsWith(state.hosts, "costs");
  const watchHosts = hostsWith(state.hosts, "watch");
  const messagingHosts = hostsWith(state.hosts, "messaging");
  const sections: SettingsSection[] = [
    {
      id: "appearance",
      label: t("prefs.appearance"),
      words: t("settingsRail.words.appearance"),
      node: (
        <Panel title={t("prefs.appearance")}>
          <SettingRow label={t("settings.theme")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="setting-select"
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
                className="setting-select"
                value={props.density}
                onChange={(e) => props.onDensity(e.target.value as Density)}
              >
                <option value="compact">{t("settings.densities.compact")}</option>
                <option value="comfortable">{t("settings.densities.comfortable")}</option>
              </NativeSelect>
            )}
          </SettingRow>
          <label className={check}>
            <input
              type="checkbox"
              checked={cacheOn}
              onChange={(e) => props.store.cacheTimer.setEnabled(e.target.checked)}
            />
            {t("settings.cacheTimer")}
          </label>
          <SettingRow label={t("settings.cacheTtl")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="setting-select"
                value={String(cacheTtl)}
                onChange={(e) => props.store.cacheTimer.setTtl(Number(e.target.value) as CacheTtl)}
              >
                <option value="300000">{t("settings.cacheTtls.fiveMinutes")}</option>
                <option value="3600000">{t("settings.cacheTtls.oneHour")}</option>
              </NativeSelect>
            )}
          </SettingRow>
          <SettingRow label={t("settings.tabOrder")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="setting-select"
                value={tabOrder}
                onChange={(e) => props.store.tabOrder.set(e.target.value as TabOrder)}
              >
                <option value="mru">{t("settings.tabOrders.mru")}</option>
                <option value="sequential">{t("settings.tabOrders.sequential")}</option>
              </NativeSelect>
            )}
          </SettingRow>
          <SettingRow label={t("settings.terminalFont")}>
            {(id) => (
              <TerminalFontInput
                id={id}
                describedBy={fontHint}
                size={terminalFont}
                onCommit={(size) => props.store.terminalFont.set(size)}
              />
            )}
          </SettingRow>
          <small id={fontHint} className="setting-hint">
            {t("settings.terminalFontRange", { min: TERMINAL_FONT_MIN, max: TERMINAL_FONT_MAX })}
          </small>
          <label className={check}>
            <input
              type="checkbox"
              checked={terminalReader}
              aria-describedby={readerHint}
              onChange={(e) => props.store.terminalReader.set(e.target.checked)}
            />
            {t("settings.terminalReader")}
          </label>
          <small id={readerHint} className="setting-hint">
            {t("settings.terminalReaderHint")}
          </small>
          <SettingRow label={t("settings.language")}>
            {(id) => (
              <NativeSelect
                id={id}
                className="setting-select"
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
      ),
    },
    {
      id: "clients",
      label: t("clients.title"),
      words: t("settingsRail.words.clients"),
      node: (
        <Panel title={t("clients.title")}>
          <p className="text-muted-foreground text-sm">{t("clients.settingsHint")}</p>
          <div>
            <Button variant="outline" onClick={() => props.store.router.push({ name: "clients" })}>
              {t("clients.manageShort")}
            </Button>
          </div>
        </Panel>
      ),
    },
    {
      id: "window",
      label: t("prefs.window"),
      words: t("settingsRail.words.window"),
      node: (
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
            <small className="setting-hint">{t("prefs.unavailable")}</small>
          )}
          <label className={check}>
            <input
              type="checkbox"
              checked={!setupHidden}
              onChange={(e) => props.store.setup.setHidden(!e.target.checked)}
            />
            {t("setup.restore")}
          </label>
          <label className={check}>
            <input
              type="checkbox"
              checked={settings.teleportPreview}
              onChange={(e) => props.store.settings.setTeleportPreview(e.target.checked)}
            />
            {t("teleportUi.preview")}
          </label>
        </Panel>
      ),
    },
    {
      id: "notifications",
      label: t("prefs.notifications"),
      words: t("settingsRail.words.notifications"),
      node: (
        <NotificationPrefs
          store={props.store}
          hosts={state.hosts}
          projects={state.projects}
          t={t}
        />
      ),
    },
    ...(settings.updaterSupported
      ? [
          {
            id: "updates",
            label: t("prefs.updates"),
            words: t("settingsRail.words.updates"),
            node: (
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
                <ActionButton
                  variant="outline"
                  className="self-start"
                  onClick={props.onCheckUpdate}
                >
                  {t("prefs.checkNow")}
                </ActionButton>
                {props.appUpdate.upToDate && (
                  <p role="status" className="text-muted-foreground text-sm">
                    {t("prefs.upToDate")}
                  </p>
                )}
                {props.appUpdate.error && (
                  <p role="alert" className="text-status-needs-you">
                    {props.appUpdate.error}
                  </p>
                )}
              </Panel>
            ),
          },
        ]
      : []),
    {
      id: "shortcut",
      label: t("prefs.shortcut"),
      words: t("settingsRail.words.shortcut"),
      node: (
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
      ),
    },
    ...(budgetHosts.length > 0
      ? [
          {
            id: "budgets",
            label: t("settingsRail.budgets"),
            words: t("settingsRail.words.budgets"),
            node: (
              <>
                {budgetHosts.map((h) => (
                  <BudgetsSection
                    key={h.id}
                    store={props.store}
                    hostId={h.id}
                    hostName={h.name}
                    budgets={state.budgets[h.id] ?? []}
                  />
                ))}
              </>
            ),
          },
        ]
      : []),
    ...(watchHosts.length > 0
      ? [
          {
            id: "watch",
            label: t("settingsRail.watch"),
            words: t("settingsRail.words.watch"),
            node: (
              <>
                {watchHosts.map((h) => (
                  <WatchSettingsSection
                    key={`watch/${h.id}`}
                    store={props.store}
                    hostId={h.id}
                    hostName={h.name}
                    projects={state.projects[h.id] ?? []}
                    near={h.hostInfo?.near}
                  />
                ))}
              </>
            ),
          },
        ]
      : []),
    ...(messagingHosts.length > 0
      ? [
          {
            id: "messaging",
            label: t("settingsRail.messaging"),
            words: t("settingsRail.words.messaging"),
            node: (
              <>
                {messagingHosts.map((h) => (
                  <MessagingRulesSection
                    key={`messaging/${h.id}`}
                    store={props.store}
                    hostId={h.id}
                    hostName={h.name}
                  />
                ))}
              </>
            ),
          },
        ]
      : []),
    {
      id: "assistant",
      label: t("settingsRail.assistant"),
      words: t("settingsRail.words.assistant"),
      node: <AssistantSettings store={props.store} t={t} />,
    },
    {
      id: "backup",
      label: t("settingsRail.backup"),
      words: t("settingsRail.words.backup"),
      node: (
        <>
          <BackupAllPanel store={props.store} />
          <BackupSchedulePanel store={props.store} />
        </>
      ),
    },
    {
      id: "webhooks",
      label: t("webhooks.title"),
      words: t("settingsRail.words.webhooks"),
      node: <WebhooksSection store={props.store} />,
    },
    // Only where the app has a log file: not in a browser.
    ...(props.store.system.logs()
      ? [
          {
            id: "diagnostics",
            label: t("diagnostics.title"),
            words: t("diagnostics.words"),
            node: <DiagnosticsPanel store={props.store} />,
          },
        ]
      : []),
  ];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sections.filter((section) =>
        `${section.label} ${section.words}`.toLowerCase().includes(needle),
      )
    : sections;
  const go = (id: string) => {
    setCurrent(id);
    const target = document.getElementById(`settings-${id}`);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  };
  // Opened on a part (a budget alert): scroll to it and focus it.
  const wanted = props.section;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request moves the view
  useEffect(() => {
    if (wanted) go(wanted);
  }, [wanted]);

  return (
    <Page title={t("prefs.title")}>
      <div className="settings-layout">
        <div className="settings-side">
          <Input
            type="search"
            aria-label={t("settingsRail.search")}
            placeholder={t("settingsRail.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label={t("settingsRail.label")} className="settings-rail">
            {shown.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                size="sm"
                className="justify-start"
                aria-current={current === section.id ? "true" : undefined}
                onClick={() => go(section.id)}
              >
                {section.label}
              </Button>
            ))}
          </nav>
        </div>
        <div className="settings-sections">
          {shown.length === 0 && <output>{t("settingsRail.none")}</output>}
          {shown.map((section) => (
            <section
              key={section.id}
              id={`settings-${section.id}`}
              aria-label={section.label}
              tabIndex={-1}
              className="settings-section"
            >
              {section.node}
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
});
