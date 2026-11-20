/** Issue #3538: what `flightdeckd terminal open|open-session|close|settings` print, as pure rules over the daemon's answers. */
import type { TerminalInfo, TerminalSettings } from "@flightdeck/protocol";
import { terminalLines } from "./terminal-read-view.ts";

/** The line of the terminal that was opened, the same as `terminal list` prints it. */
export function openedLine(terminal: TerminalInfo): string {
  return `opened ${terminalLines([terminal])[0]}`;
}

/** `killed` when the process ended, `closed` when the terminal was only detached (or a dead one removed). */
export function closedLine(terminalId: string, kill: boolean): string {
  return `${kill ? "killed" : "closed"} ${terminalId}`;
}

export function settingsLine(settings: TerminalSettings): string {
  return `terminals ${settings.enabled ? "on" : "off"}  max ${settings.max}  shell ${settings.shell}`;
}
