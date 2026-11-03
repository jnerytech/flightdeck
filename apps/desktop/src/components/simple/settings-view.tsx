import type { Lang, T } from "../../i18n/index.ts";
import type { ThemeMode } from "../../lib/theme.ts";

export interface SettingsViewProps {
  t: T;
  lang: Lang;
  onLang(lang: Lang): void;
  theme: ThemeMode;
  onTheme(mode: ThemeMode): void;
  /** The folders tasks may use: the host's allowed folders. */
  folders: string[];
  onAddFolder(path: string): Promise<boolean>;
  canPickFolder: boolean;
  onPickFolder(): Promise<string | null>;
  notifications: boolean;
  onNotifications(enabled: boolean): void;
  /** Whether the app offers the way back to the full app (the host is not locked). */
  canSwitch: boolean;
  onShowEverything(): void;
}

/** The little Settings of simple mode: language, theme, folders, notifications and the switch. */
export function SettingsView(_props: SettingsViewProps) {
  return null;
}
