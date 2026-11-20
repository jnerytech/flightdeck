/**
 * Where the app keeps what `--host` reads (issue #3429, `docs/decisions/2026-11-20-cli-host-credentials.md`):
 * the index of host names, and the credential helper that ships beside the app. Pure: the caller gives the
 * environment.
 */
import { posix, win32 } from "node:path";

/** The app's Tauri identifier: its config folder is named after it. A test pins it to `tauri.conf.json`. */
export const APP_IDENTIFIER = "";

export interface PathsEnv {
  platform: string;
  home: string;
  /** `%APPDATA%` (Windows). */
  appData?: string;
  /** `%LOCALAPPDATA%` (Windows). */
  localAppData?: string;
  /** `$XDG_CONFIG_HOME` (Linux). */
  xdgConfigHome?: string;
  /** The running `flightdeckd`: the helper is looked for beside it. */
  execPath: string;
}

/** `<app config dir>/hosts.json`: where Tauri's `app_config_dir()` puts the app's files on this system. */
export function hostIndexPath(_env: PathsEnv): string {
  return "";
}

/** The only places the helper may be, in the order they are tried. Never the PATH. */
export function helperCandidates(_env: PathsEnv): string[] {
  return [];
}
