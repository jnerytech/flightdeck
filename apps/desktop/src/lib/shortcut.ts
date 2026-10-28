/** System-wide shortcut that brings the app forward with the global search open. */
export const DEFAULT_SHORTCUT = "Ctrl+Alt+F";

/** Plain settings key for the chosen shortcut. */
export const SHORTCUT_KEY = "flightdeck.globalShortcut";

export type ShortcutCheck = { ok: true; value: string } | { ok: false; error: string };

/** Accepted spellings of each modifier, mapped to the name the Tauri plugin parses. */
const MODIFIERS: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Super",
  meta: "Super",
  cmd: "Super",
  command: "Super",
  win: "Super",
};
const ORDER = ["Ctrl", "Alt", "Shift", "Super"];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4]))$/;

/**
 * Checks and normalizes a shortcut such as `Ctrl+Alt+F`. A letter, digit or F-key with at least
 * one of Ctrl, Alt or Super (Shift alone would steal plain typing). `Ctrl+K` stays the in-app
 * search: as a global shortcut it would clash with browsers and VS Code.
 */
export function validateShortcut(text: string): ShortcutCheck {
  const parts = text.split("+").map((p) => p.trim());
  const key = (parts.pop() ?? "").toUpperCase();
  const modifiers = parts.map((p) => MODIFIERS[p.toLowerCase()]);
  if (!KEY.test(key) || modifiers.includes(undefined) || new Set(modifiers).size < parts.length) {
    return { ok: false, error: "formato esperado: Modificadores+Tecla, por exemplo Ctrl+Alt+F" };
  }
  if (!modifiers.some((m) => m !== "Shift")) {
    return { ok: false, error: "use ao menos Ctrl, Alt ou Super" };
  }
  const value = [...ORDER.filter((m) => modifiers.includes(m)), key].join("+");
  if (value === "Ctrl+K") {
    return { ok: false, error: "Ctrl+K abre a busca dentro do app; escolha outro atalho" };
  }
  return { ok: true, value };
}
