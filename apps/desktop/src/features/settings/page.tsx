import { memo, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssistantSettings } from "@/features/assistant/ui.ts";
import { BackupAllPanel, BackupSchedulePanel } from "@/features/backup/ui.ts";
import { BudgetsSection } from "@/features/costs/ui.ts";
import { NotificationPrefs } from "@/features/notifications/ui.ts";
import type { Density, ThemeMode } from "@/features/shell/index.ts";
import { WatchSettingsSection } from "@/features/watch/ui.ts";
import { useStoreSlice } from "@/lib/use-store";
import { Page, Panel } from "@/shared/layout/index.ts";
import type { Lang, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hostsWith } from "../../lib/version.ts";
import type { AppUpdateState } from "../appupdate/index.ts";
import { MessagingRulesSection } from "../messaging/ui.ts";
import { WebhooksSection } from "../webhook/ui.ts";
import { AppearanceSection } from "./appearance-section.tsx";
import { DiagnosticsPanel } from "./diagnostics-panel.tsx";
import type { Settings as SettingsState } from "./index.ts";
import { useSettingsRail } from "./settings-rail.ts";
import { ShortcutSection } from "./shortcut-section.tsx";
import { UpdatesSection } from "./updates-section.tsx";
import { WindowSection } from "./window-section.tsx";

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
  const { settings } = props;
  const [query, setQuery] = useState("");
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
        <AppearanceSection
          store={props.store}
          t={t}
          theme={props.theme}
          onTheme={props.onTheme}
          density={props.density}
          onDensity={props.onDensity}
          lang={props.lang}
          onLang={props.onLang}
        />
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
        <WindowSection
          store={props.store}
          settings={settings}
          t={t}
          onCloseToTray={props.onCloseToTray}
          onAutostart={props.onAutostart}
        />
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
              <UpdatesSection
                settings={settings}
                appUpdate={props.appUpdate}
                t={t}
                onCheckUpdate={props.onCheckUpdate}
                onNotifyUpdates={props.onNotifyUpdates}
                onAutoUpdate={props.onAutoUpdate}
              />
            ),
          },
        ]
      : []),
    {
      id: "shortcut",
      label: t("prefs.shortcut"),
      words: t("settingsRail.words.shortcut"),
      node: <ShortcutSection settings={settings} t={t} onGlobalShortcut={props.onGlobalShortcut} />,
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
  let matchText = "";
  if (shown.length === 0) matchText = t("settingsRail.none");
  else if (needle)
    matchText =
      shown.length === 1
        ? t("settingsRail.matchesOne")
        : t("settingsRail.matches", { n: shown.length });
  const { current, go } = useSettingsRail(shown, props.section);

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
          {/* Always there, so a reader hears the count change: silent with no search. */}
          <output className={shown.length === 0 ? undefined : "sr-only"}>{matchText}</output>
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
