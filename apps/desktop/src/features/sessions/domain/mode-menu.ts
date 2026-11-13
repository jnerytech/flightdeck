import { clampPermissionMode, type PermissionMode, type SettableMode } from "@flightdeck/protocol";

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

export function modeRows(opts: {
  /** Null while the session has not said its mode: no row is the current one. */
  current: PermissionMode | null;
  start: PermissionMode;
  bypassAllowed: boolean;
}): ModeRow[] {
  return MENU_MODES.map((mode) => {
    let blocked: ModeBlock | null = null;
    if (!opts.bypassAllowed) {
      if (mode === "bypassPermissions") blocked = "bypassOff";
      // The daemon's rule: only the start mode itself or a stricter one (clampPermissionMode).
      else if (clampPermissionMode(mode, opts.start) !== mode) blocked = "looserThanStart";
    }
    return { mode, current: mode === opts.current, blocked };
  });
}

/** The cycle of Shift+Tab: the first three of the menu; bypass is only ever chosen from the menu. */
const CYCLE: readonly SettableMode[] = ["default", "acceptEdits", "plan"];

/** The mode Shift+Tab goes to from `current`, or null when there is none to go to. */
export function nextMode(rows: ModeRow[], current: PermissionMode | null): SettableMode | null {
  const open = new Set(rows.filter((r) => r.blocked === null).map((r) => r.mode));
  const from = current === null ? -1 : CYCLE.indexOf(current as SettableMode);
  for (let step = 1; step <= CYCLE.length; step++) {
    const mode = CYCLE[(from + step + CYCLE.length) % CYCLE.length] as SettableMode;
    if (mode !== current && open.has(mode)) return mode;
  }
  return null;
}
