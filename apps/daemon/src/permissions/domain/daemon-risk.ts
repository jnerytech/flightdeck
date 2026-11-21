import { runsCliVerb } from "./shell-call.ts";

/**
 * `update apply` has the daemon download and install a newer build and restart, and `daemon stop` ends it with
 * every session and terminal it runs (#3780). The app asks the person for each; from a shell `--confirm` is only a
 * typed word (#3439), so both are high on the verb alone, with or without the flag, and a line whose flag a shell
 * or `xargs` supplies is no loophole. `update check` only reads, and `update --from <binary>` is the install of a
 * file the caller already has: both stay ordinary.
 */
export const DAEMON_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) => runsCliVerb(prog, args, "update", ["apply"]),
    reason: () =>
      "makes this host's daemon download and install a newer build and restart, which the app asks the person to confirm and which a model's shell has no reason to start (flightdeckd update apply)",
  },
  {
    when: (prog, args) => runsCliVerb(prog, args, "daemon", ["stop"]),
    reason: () =>
      "stops this host's daemon, and with it every session and terminal it runs, which the app asks the person to confirm (flightdeckd daemon stop)",
  },
];
