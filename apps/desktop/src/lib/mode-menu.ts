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

/** From the strictest to the loosest: a session may not be made looser than it started (the daemon's rule). */
const STRICTNESS: readonly SettableMode[] = ["plan", "default", "acceptEdits", "bypassPermissions"];

export function modeRows(opts: {
  current: PermissionMode;
  start: PermissionMode;
  bypassAllowed: boolean;
}): ModeRow[] {
  const startAt = STRICTNESS.indexOf(opts.start as SettableMode);
  return MENU_MODES.map((mode) => {
    let blocked: ModeBlock | null = null;
    if (!opts.bypassAllowed) {
      if (mode === "bypassPermissions") blocked = "bypassOff";
      else if (startAt >= 0 && STRICTNESS.indexOf(mode) > startAt) blocked = "looserThanStart";
    }
    return { mode, current: mode === opts.current, blocked };
  });
}

/** The cycle of Shift+Tab: the first three of the menu; bypass is only ever chosen from the menu. */
const CYCLE: readonly SettableMode[] = ["default", "acceptEdits", "plan"];

/** The mode Shift+Tab goes to from `current`, or null when there is none to go to. */
export function nextMode(rows: ModeRow[], current: PermissionMode): SettableMode | null {
  const open = new Set(rows.filter((r) => r.blocked === null).map((r) => r.mode));
  const from = CYCLE.indexOf(current as SettableMode);
  for (let step = 1; step <= CYCLE.length; step++) {
    const mode = CYCLE[(from + step + CYCLE.length) % CYCLE.length] as SettableMode;
    if (mode !== current && open.has(mode)) return mode;
  }
  return null;
}
