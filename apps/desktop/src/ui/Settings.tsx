import { useState } from "react";
import type { AppState, AppStore, Settings as SettingsState } from "../lib/app-store.ts";
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
}) {
  const { settings } = props;
  const [shortcut, setShortcut] = useState(settings.globalShortcut);
  const shortcutOff = !settings.globalShortcutSupported;
  return (
    <section className="card form">
      <h2>Configurações</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.closeToTray}
          onChange={(e) => props.onCloseToTray(e.target.checked)}
        />
        Fechar a janela manda para a bandeja
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.autostart}
          disabled={!settings.autostartSupported}
          onChange={(e) => props.onAutostart(e.target.checked)}
        />
        Iniciar com o Windows
      </label>
      {!settings.autostartSupported && (
        <small className="muted">indisponível nesta plataforma</small>
      )}
      <h3>Atalho global</h3>
      <small className="muted">
        Traz o Flightdeck para frente com a busca aberta, mesmo em segundo plano. Dentro do app,
        Ctrl+K continua abrindo a busca.
      </small>
      {settings.shortcutProblem && <p className="warn">{settings.shortcutProblem}</p>}
      <div className="row">
        <input
          aria-label="Atalho global"
          value={shortcut}
          disabled={shortcutOff}
          onChange={(e) => setShortcut(e.target.value)}
        />
        <button
          type="button"
          disabled={shortcutOff}
          onClick={() => props.onGlobalShortcut(shortcut)}
        >
          Salvar atalho
        </button>
      </div>
      {settings.shortcutError && <small className="error">{settings.shortcutError}</small>}
      {shortcutOff && <small className="muted">atalho global indisponível nesta plataforma</small>}
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
    </section>
  );
}
