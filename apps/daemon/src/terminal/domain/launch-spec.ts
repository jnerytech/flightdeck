import { TERMINAL_LAUNCH_VAR } from "../../central/index.ts";
import { buildChildEnv, FlightdeckError } from "../../kernel/index.ts";

/** The `claude` of an open request ("Claude here") and the daemon command line it runs through. */
export interface ClaudeHere {
  request: { resume?: string; persona?: string };
  /** This daemon's own command line and config; absent when this host has none. */
  daemon: { self: string[]; configFile: string } | undefined;
}

/**
 * What a terminal runs: the argv, the id of the launch the wrapper will register (only for
 * "Claude here") and the variables that launch adds to the environment. Issue #1589: moved from
 * the terminal manager so the choice of what runs is a function of its inputs.
 */
export function launchArgv(input: {
  command: string[] | undefined;
  claude: ClaudeHere | undefined;
  newLaunchId: () => string;
  shell: () => string[];
}): { argv: string[]; launchId: string | null; extraEnv: Record<string, string> } {
  const { claude } = input;
  if (!claude) {
    return { argv: input.command ?? input.shell(), launchId: null, extraEnv: {} };
  }
  if (!claude.daemon) {
    throw new FlightdeckError(
      "invalid_state",
      "Claude here is not available on this host",
      "claude_here_unavailable",
    );
  }
  // The launch that `flightdeckd claude` will register: the session it opens is this one.
  const launchId = input.newLaunchId();
  const argv = [
    ...claude.daemon.self,
    "claude",
    ...(claude.request.resume ? ["--resume", claude.request.resume] : []),
    // Phase 20: the wrapper asks the daemon for the persona and appends it to the system prompt.
    ...(claude.request.persona ? ["--persona", claude.request.persona] : []),
  ];
  return {
    argv,
    launchId,
    extraEnv: { FLIGHTDECK_CONFIG: claude.daemon.configFile, [TERMINAL_LAUNCH_VAR]: launchId },
  };
}

/**
 * The environment of a terminal's process. Issue #486: in Claude Code's fullscreen mode each wheel
 * notch reaches it as one report; 3 lines a notch is how Windows Terminal and VS Code feel. A value
 * the host's environment or the person's Claude Code settings (where /scroll-speed keeps it)
 * already set is theirs, and one the request sets wins over all.
 */
export function terminalEnv(input: {
  host: Record<string, string | undefined>;
  /** The env block of the host's Claude Code settings. */
  kept: Record<string, string>;
  allowApiKey: boolean;
  /** What the launch adds (`launchArgv`). */
  extraEnv: Record<string, string>;
  /** What the request sets, for daemon code. */
  requested: Record<string, string> | undefined;
}): Record<string, string> {
  const { host, kept } = input;
  const scrollDefault: Record<string, string> =
    host.CLAUDE_CODE_SCROLL_SPEED || kept.CLAUDE_CODE_SCROLL_SPEED
      ? {}
      : { CLAUDE_CODE_SCROLL_SPEED: "3" };
  return {
    ...scrollDefault,
    ...buildChildEnv(host, input.allowApiKey),
    // What is attached is xterm.js. A service has no TERM (or "dumb"), and readline then
    // scrolls a long line sideways instead of wrapping it.
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...input.extraEnv,
    ...input.requested,
  };
}
