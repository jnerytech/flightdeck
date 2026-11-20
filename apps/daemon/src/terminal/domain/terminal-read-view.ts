/** Issue #3538: what `flightdeckd terminal list` prints, as a pure rule over the daemon's answer. */
import type { TerminalInfo } from "@flightdeck/protocol";

/** One line per terminal, or a sentence when there is none; `command` is the program only, never its arguments. */
export function terminalLines(terminals: TerminalInfo[]): string[] {
  if (terminals.length === 0) return ["no terminal"];
  return terminals.map((t) => {
    const parts = [
      t.terminalId,
      t.command,
      t.cwd,
      `${t.cols}x${t.rows}`,
      t.exitCode === null ? "running" : `exited ${t.exitCode}`,
      `attached: ${t.attached}`,
      `started: ${t.startedAt}`,
    ];
    if (t.launchId !== null) parts.push(`launch: ${t.launchId}`);
    return parts.join("  ");
  });
}
