/**
 * The keyboard shortcuts, public entry (#1589): the registry and its chords, the typing and grid keys, the
 * global shortcut check. Another domain imports from here, never a file inside. The sheet and the
 * keycap are components, in ui.ts (#2451).
 */
export { gridStep } from "./domain/grid-keys.ts";
export { typing } from "./domain/keys.ts";
export { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } from "./domain/shortcut.ts";
export {
  CHORD_TIMEOUT_MS,
  type ChordState,
  chordStep,
  isMac,
  keysLabel,
  NO_CHORD,
  type ShortcutAction,
  shortcutOf,
} from "./domain/shortcuts.ts";
