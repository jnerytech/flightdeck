/** Tauri commands that may stay synchronous: they touch the tray or window, which need the main thread. */
export const SYNC_COMMANDS_ALLOWED: string[] = [];

/** Daemon files that may call `Bun.spawnSync`, each with an async twin and a warm path. */
export const SPAWN_SYNC_ALLOWED: string[] = [];

/** `keys.keyFor(` calls allowed in `main.ts`: each sits behind a warm of the folder's key. */
export const MAIN_KEY_FOR_ALLOWED = 0;

/** The names of the `#[tauri::command]` functions that are not `async`. */
export function syncTauriCommands(_rust: string): string[] {
  return ["?"];
}
