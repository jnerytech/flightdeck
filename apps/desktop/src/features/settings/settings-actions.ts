import type { Density, ThemeMode } from "@/features/shell/index.ts";
import type { Lang } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store.ts";

/**
 * Props that are functions keep their identity between renders, so the `memo` of the page they go
 * to holds: one set per store.
 */
const SETTINGS_ACTIONS = new WeakMap<AppStore, ReturnType<typeof makeSettingsActions>>();
function makeSettingsActions(store: AppStore) {
  return {
    onCloseToTray: (enabled: boolean) => void store.settings.setCloseToTray(enabled),
    onAutostart: (enabled: boolean) => void store.settings.setAutostart(enabled),
    onGlobalShortcut: (text: string) => void store.settings.setGlobalShortcut(text),
    onCheckUpdate: () => store.appUpdates.check(),
    onNotifyUpdates: (enabled: boolean) => store.settings.setNotifyUpdates(enabled),
    onAutoUpdate: (enabled: boolean) => store.settings.setAutoUpdate(enabled),
    onTheme: (mode: ThemeMode) => store.theme.setMode(mode),
    onDensity: (density: Density) => store.density.set(density),
    onLang: (next: Lang) => store.i18n.setLang(next),
  };
}
export function settingsActions(store: AppStore) {
  const known = SETTINGS_ACTIONS.get(store);
  if (known) return known;
  const actions = makeSettingsActions(store);
  SETTINGS_ACTIONS.set(store, actions);
  return actions;
}
