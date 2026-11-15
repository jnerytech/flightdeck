import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssistantSettings } from "@/features/assistant/ui.ts";
import { BackupAllPanel, BackupSchedulePanel } from "@/features/backup/ui.ts";
import { BudgetsSection } from "@/features/costs/ui.ts";
import { NotificationPrefs } from "@/features/notifications/ui.ts";
import type { Density, ThemeMode } from "@/features/shell/index.ts";
import { WatchSettingsSection } from "@/features/watch/ui.ts";
import { useStoreSlice } from "@/lib/use-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Page, Panel } from "@/shared/layout/index.ts";
import type { Lang, T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hostsWith } from "../../lib/version.ts";
import type { AppUpdateState } from "../appupdate/index.ts";
import { MessagingRulesSection } from "../messaging/ui.ts";
import { WebhooksSection } from "../webhook/ui.ts";
import { AppearanceSection, check } from "./appearance-section.tsx";
import { DiagnosticsPanel } from "./diagnostics-panel.tsx";
import type { Settings as SettingsState } from "./index.ts";
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
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
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
                  <output className="block text-muted-foreground text-sm">
                    {t("prefs.upToDate")}
                  </output>
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
  let matchText = "";
  if (shown.length === 0) matchText = t("settingsRail.none");
  else if (needle)
    matchText =
      shown.length === 1
        ? t("settingsRail.matchesOne")
        : t("settingsRail.matches", { n: shown.length });
  // A click's mark holds while the page scrolls to the section (a short last one never reaches the
  // observer's band); the next wheel, touch or key hands the mark back to the scroll.
  const pinned = useRef(false);
  const go = (id: string) => {
    pinned.current = true;
    setCurrent(id);
    const target = document.getElementById(`settings-${id}`);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  };
  // The rail marks the section on screen: the upper one when several are. Without the observer
  // (tests, old webviews) the mark is the last one a click went to.
  const shownIds = shown.map((section) => section.id).join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = shownIds ? shownIds.split(",") : [];
    const onScreen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^settings-/, "");
          if (entry.isIntersecting) onScreen.add(id);
          else onScreen.delete(id);
        }
        const first = ids.find((id) => onScreen.has(id));
        if (first && !pinned.current) setCurrent(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(`settings-${id}`);
      if (el) observer.observe(el);
    }
    const release = () => {
      pinned.current = false;
    };
    const handBack = ["wheel", "touchstart", "keydown"] as const;
    for (const type of handBack) window.addEventListener(type, release, { passive: true });
    return () => {
      observer.disconnect();
      for (const type of handBack) window.removeEventListener(type, release);
    };
  }, [shownIds]);
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
