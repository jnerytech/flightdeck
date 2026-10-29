// Read by typecheck only (no test runs it): a dictionary with a key missing, or with an extra one,
// does not compile. If the type ever stopped checking that, these @ts-expect-error lines would be
// unused and typecheck would fail.
import { en } from "../src/i18n/en.ts";
import type { Dictionary, Key } from "../src/i18n/index.ts";

const { quit: _quit, ...trayWithoutQuit } = en.tray;

// @ts-expect-error: tray.quit is missing
export const missing: Dictionary = { ...en, tray: trayWithoutQuit };

export const extra: Dictionary = {
  ...en,
  // @ts-expect-error: tray.reboot is not a key of pt-BR
  tray: { ...en.tray, reboot: "Reboot" },
};

// @ts-expect-error: not a key
export const unknownKey: Key = "tray.reboot";
export const knownKey: Key = "tray.waiting";
