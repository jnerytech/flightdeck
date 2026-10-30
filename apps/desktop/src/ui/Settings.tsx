import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LANGS, type Lang, type T } from "../i18n/index.ts";
import type {
  AppState,
  AppStore,
  AppUpdateState,
  Settings as SettingsState,
} from "../lib/app-store.ts";
import type { Density } from "../lib/density.ts";
import type { ThemeMode } from "../lib/theme.ts";
import { hasFeature } from "../lib/version.ts";
import { BudgetsSection } from "./BudgetsSection.tsx";

/**
 * App preferences: close-to-tray (on by default), start with Windows (off by default) and the
 * global shortcut that opens the search (Ctrl+Alt+F by default).
 */
export function Settings(props: {
  store: AppStore;
  state: AppState;
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
  const { t } = props;
  const { settings } = props;
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  const select =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  /** A checkbox with its sentence on its right. */
  const check = "flex items-center gap-2 text-sm";
  return (
    <Page title="Configurações">
      <div className="flex max-w-2xl flex-col gap-5">
        <Panel title="Aparência">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>{t("settings.theme")}</span>
            <select
              aria-label={t("settings.theme")}
              className={select}
              value={props.theme}
              onChange={(e) => props.onTheme(e.target.value as ThemeMode)}
            >
              <option value="system">{t("settings.themes.system")}</option>
              <option value="light">{t("settings.themes.light")}</option>
              <option value="dark">{t("settings.themes.dark")}</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>{t("settings.density")}</span>
            <select
              aria-label={t("settings.density")}
              className={select}
              value={props.density}
              onChange={(e) => props.onDensity(e.target.value as Density)}
            >
              <option value="compact">{t("settings.densities.compact")}</option>
              <option value="comfortable">{t("settings.densities.comfortable")}</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>{t("settings.language")}</span>
            <select
              aria-label={t("settings.language")}
              className={select}
              value={props.lang}
              onChange={(e) => props.onLang(e.target.value as Lang)}
            >
              {LANGS.map((lang) => (
                <option key={lang} value={lang}>
                  {t(`languages.${lang}`)}
                </option>
              ))}
            </select>
          </div>
        </Panel>
        <Panel title="Janela">
          <label className={check}>
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => props.onCloseToTray(e.target.checked)}
            />
            Fechar a janela manda para a bandeja
          </label>
          <label className={check}>
            <input
              type="checkbox"
              checked={settings.autostart}
              disabled={!settings.autostartSupported}
              onChange={(e) => props.onAutostart(e.target.checked)}
            />
            Iniciar com o Windows
          </label>
          {!settings.autostartSupported && (
            <small className="text-muted-foreground text-xs">indisponível nesta plataforma</small>
          )}
        </Panel>
        {settings.updaterSupported && (
          <Panel title="Atualizações">
            <label className={check}>
              <input
                type="checkbox"
                aria-label="Avisar sobre atualizações"
                checked={settings.notifyUpdates}
                onChange={(e) => props.onNotifyUpdates(e.target.checked)}
              />
              Avisar sobre atualizações
            </label>
            <Button variant="outline" className="self-start" onClick={props.onCheckUpdate}>
              Procurar atualização agora
            </Button>
            {props.appUpdate.upToDate && (
              <p className="text-muted-foreground text-sm">Você está na versão mais recente</p>
            )}
          </Panel>
        )}
        <Panel title="Atalho global">
          <small className="text-muted-foreground text-xs">
            Traz o Flightdeck para frente com a busca aberta, mesmo em segundo plano. Dentro do app,
            Ctrl+K continua abrindo a busca.
          </small>
          {settings.shortcutProblem && <InlineNotice>{settings.shortcutProblem}</InlineNotice>}
          <div className="flex items-center gap-2">
            <Input
              aria-label="Atalho global"
              className="w-56"
              value={shortcut}
              disabled={shortcutOff}
              onChange={(e) => setShortcut(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={shortcutOff}
              onClick={() => props.onGlobalShortcut(shortcut)}
            >
              Salvar atalho
            </Button>
          </div>
          {settings.shortcutError && (
            <small className="text-status-error text-xs">{settings.shortcutError}</small>
          )}
          {shortcutOff && (
            <small className="text-muted-foreground text-xs">
              atalho global indisponível nesta plataforma
            </small>
          )}
        </Panel>
        {props.state.hosts
          // Budgets came with the costs (phase 8).
          .filter((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false))
          .map((h) => (
            <BudgetsSection
              key={h.id}
              store={props.store}
              hostId={h.id}
              hostName={h.name}
              budgets={props.state.budgets[h.id] ?? []}
            />
          ))}
      </div>
    </Page>
  );
}
