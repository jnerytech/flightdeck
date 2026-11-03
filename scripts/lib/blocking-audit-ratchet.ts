/** Tauri commands that may stay synchronous: they touch the tray or window, which need the main thread. */
export const SYNC_COMMANDS_ALLOWED = [
  "focus_main",
  "set_close_to_tray",
  "tray_set_menu",
  "tray_set_status",
  "vault_remove_file",
];

/**
 * Daemon files that may call `Bun.spawnSync`. Each has an async twin and a warm path, so the
 * blocking call only runs for a folder nobody looked up yet (see their doc comments).
 * `fake-runtime.ts` is the test runtime.
 */
export const SPAWN_SYNC_ALLOWED = [
  "board/worktree.ts",
  "central/project-key.ts",
  "memory/memory.ts",
  "runtime/fake-runtime.ts",
];

/**
 * `keys.keyFor(` calls allowed in `main.ts`: the usage indexer, the board's budgets, the actions'
 * rules and the name tracker. Each folder is warmed first (`warmKeys`, `warmProjectKeys`, `warm`).
 */
export const MAIN_KEY_FOR_ALLOWED = 4;

/** The names of the `#[tauri::command]` functions that are not `async`. */
export function syncTauriCommands(rust: string): string[] {
  return [...rust.matchAll(/#\[tauri::command[^\]]*\]\s*(async\s+)?fn\s+(\w+)/g)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2] as string);
}
