import type { Settings as SettingsState } from "../lib/app-store.ts";

/** App preferences: close-to-tray (on by default) and start with Windows (off by default). */
export function Settings(props: {
  settings: SettingsState;
  onCloseToTray(enabled: boolean): void;
  onAutostart(enabled: boolean): void;
}) {
  const { settings } = props;
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
    </section>
  );
}
