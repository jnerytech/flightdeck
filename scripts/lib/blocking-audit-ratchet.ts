/**
 * Tauri commands that may stay synchronous: they touch the tray or window, which need the main
 * thread, or end the app (`quit_now`, #402: `exit` only hands the event loop a message).
 */
export const SYNC_COMMANDS_ALLOWED = [
  "focus_main",
  "quit_now",
  "set_close_to_tray",
  // Issue #233: the taskbar overlay is a window call.
  "set_unread_badge",
  "tray_set_menu",
  "tray_set_status",
];

/** The names of the `#[tauri::command]` functions that are not `async`. */
export function syncTauriCommands(rust: string): string[] {
  return [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*(async\s+)?fn\s+(\w+)/g)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2] as string);
}

/** Async commands that may do their blocking work inline: none, the dialogs wait on the blocking pool too. */
export const ASYNC_INLINE_ALLOWED: string[] = [];

/** The async commands whose body never calls `spawn_blocking`: they still block a runtime worker. */
export function asyncCommandsInline(rust: string): string[] {
  return [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*async\s+fn\s+(\w+)[\s\S]*?\n\}\n/g)]
    .filter((match) => !match[0].includes("spawn_blocking"))
    .map((match) => match[1] as string);
}
