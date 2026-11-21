import { runsCliVerb } from "./shell-call.ts";

/**
 * A session changing the telemetry opt-in from a shell (#3755). `telemetry install` writes the exporter keys
 * into the person's `~/.claude/settings.json` and `telemetry uninstall` takes them out and rotates the receiver
 * token, so every Claude session of the account starts or stops sending its timing to the daemon. The app asks
 * the person first. `status`, `session` and `summary` only read, and `costs sessions` reads too, so they stay ordinary.
 */
const changesTheOptIn = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "telemetry", ["install", "uninstall"]);

/** The `telemetry` verbs that are high from a shell, with what they are stopped for. */
export const TELEMETRY_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesTheOptIn,
    reason: () =>
      "changes the Claude Code settings of the person's account: `telemetry install` writes the exporter keys into ~/.claude/settings.json and `telemetry uninstall` takes them out and rotates the receiver token, so every Claude session of the account starts or stops sending its timing to the daemon (flightdeckd telemetry install or uninstall)",
  },
];
