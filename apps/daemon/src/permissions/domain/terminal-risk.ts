import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * Opening a terminal, or turning the host's terminals on (#3538): `terminal open` and `open-session`
 * start a shell the session then drives, on the host and with its environment, and `settings --enable`
 * is the switch that allows any terminal at all. `list` reads. `close --kill` and `settings --disable`
 * end terminals (the second ends every one) but grant nothing: they stay ordinary shell commands, a loss of
 * running work and not a shell for the session (decision record 2026-11-20-cli-terminal).
 */
export function opensATerminal(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action]) => {
    return command === "terminal" && (action === "open" || action === "open-session");
  });
}

export function enablesTerminals(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action], own) => {
    return command === "terminal" && action === "settings" && own.includes("--enable");
  });
}
