/**
 * The keyboard shortcuts, public entry (#1589): the registry and its chords, the typing and grid keys, the
 * global shortcut check, the sheet and the keycap. Another domain imports from here, never a file inside.
 */
export { gridStep } from "./grid-keys.ts";
export { Keycap, ShortcutKeys } from "./keycap.tsx";
export { typing } from "./keys.ts";
export { DEFAULT_SHORTCUT, SHORTCUT_KEY, validateShortcut } from "./shortcut.ts";
export {
  CHORD_TIMEOUT_MS,
  type ChordState,
  chordStep,
  isMac,
  keysLabel,
  NO_CHORD,
  type ShortcutAction,
  shortcutOf,
} from "./shortcuts.ts";
export { ShortcutsSheet } from "./shortcuts-sheet.tsx";
