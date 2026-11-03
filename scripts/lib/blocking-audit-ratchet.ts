/** Tauri commands that may stay synchronous: they touch the tray or window, which need the main thread. */
export const SYNC_COMMANDS_ALLOWED = [
  "focus_main",
  "set_close_to_tray",
  "tray_set_menu",
  "tray_set_status",
  "vault_remove_file",
];

/** The names of the `#[tauri::command]` functions that are not `async`. */
export function syncTauriCommands(rust: string): string[] {
  return [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*(async\s+)?fn\s+(\w+)/g)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2] as string);
}

/** Async commands that wait on the user (a dialog), so a worker thread is the right place for them. */
export const ASYNC_INLINE_ALLOWED = ["pick_folder", "vault_pick_file"];

/** The async commands whose body never calls `spawn_blocking`: they still block a runtime worker. */
export function asyncCommandsInline(rust: string): string[] {
  return [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*async\s+fn\s+(\w+)[\s\S]*?\n\}\n/g)]
    .filter((match) => !match[0].includes("spawn_blocking"))
    .map((match) => match[1] as string);
}
