import { memo, type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";
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
import { WebhooksSection } from "./WebhooksSection.tsx";

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
  section?: string | undefined;
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
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  /** A checkbox with its sentence on its right. */
  const check = "flex items-center gap-2 text-sm";
  const budgetHosts = state.hosts.filter(
    // Budgets came with the costs (phase 8).
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
  );
  const watchHosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "watch", false),
  );
  const messagingHosts = state.hosts.filter(
    (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
  );
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
            <small className="text-muted-foreground text-xs">{t("prefs.unavailable")}</small>
          )}
        </Panel>
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
                <Button variant="outline" className="self-start" onClick={props.onCheckUpdate}>
                  {t("prefs.checkNow")}
                </Button>
                {props.appUpdate.upToDate && (
                  <p className="text-muted-foreground text-sm">{t("prefs.upToDate")}</p>
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
      id: "webhooks",
      label: t("webhooks.title"),
      words: t("settingsRail.words.webhooks"),
      node: <WebhooksSection store={props.store} />,
    },
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
