/**
 * Where the app keeps what `--host` reads (issue #3429, `docs/decisions/2026-11-20-cli-host-credentials.md`):
 * the index of host names, and the credential helper that ships beside the app. Pure: the caller gives the
 * environment.
 */
import { posix, win32 } from "node:path";

/** The app's Tauri identifier: its config folder is named after it. A test pins it to `tauri.conf.json`. */
export const APP_IDENTIFIER = "dev.flightdeck.app";

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

const HELPER = "flightdeck-cred";

/** `<app config dir>/hosts.json`: where Tauri's `app_config_dir()` puts the app's files on this system. */
export function hostIndexPath(env: PathsEnv): string {
  if (env.platform === "win32")
    return win32.join(
      env.appData ?? win32.join(env.home, "AppData", "Roaming"),
      APP_IDENTIFIER,
      "hosts.json",
    );
  if (env.platform === "darwin")
    return posix.join(env.home, "Library", "Application Support", APP_IDENTIFIER, "hosts.json");
  return posix.join(
    env.xdgConfigHome || posix.join(env.home, ".config"),
    APP_IDENTIFIER,
    "hosts.json",
  );
}

/** The only places the helper may be, in the order they are tried. Never the PATH. */
export function helperCandidates(env: PathsEnv): string[] {
  if (env.platform === "win32") {
    const beside = win32.join(win32.dirname(env.execPath), `${HELPER}.exe`);
    if (!env.localAppData) return [beside];
    return [beside, win32.join(env.localAppData, "Programs", "flightdeck", `${HELPER}.exe`)];
  }
  const beside = posix.join(posix.dirname(env.execPath), HELPER);
  if (env.platform === "darwin")
    return [beside, posix.join("/Applications/Flightdeck.app/Contents/MacOS", HELPER)];
  return [beside];
}
