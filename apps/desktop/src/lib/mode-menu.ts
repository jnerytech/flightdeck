import type { PermissionMode, SettableMode } from "@flightdeck/protocol";

/** Why a mode cannot be picked: the host's bypass switch is off, or it is looser than the start mode. */
export type ModeBlock = "bypassOff" | "looserThanStart";

export interface ModeRow {
  mode: SettableMode;
  current: boolean;
  blocked: ModeBlock | null;
}

/** The modes of the menu, in the order of the numbers 1 to 4. */
export const MENU_MODES: readonly SettableMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

export function modeRows(_opts: {
  current: PermissionMode;
  start: PermissionMode;
  bypassAllowed: boolean;
}): ModeRow[] {
  return [];
}

/** The mode Shift+Tab goes to from `current`, or null when there is none to go to. */
export function nextMode(_rows: ModeRow[], _current: PermissionMode): SettableMode | null {
  return null;
}
