import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * `host bypass on` lets every session on the host run without permission prompts, and `host updates on` has the
 * daemon install a new version and restart itself (#3699). Both are choices the app asks the person for, and from
 * a shell they are only typed words, so they are high. Only the word `off` is ordinary: a switch the shell expands
 * or that is missing could be `on`. `sleep`, `keep-awake`, `pause` and `resources pause-at` change how the host
 * waits and stay ordinary; `resources end-orphan` ends a process by its pid, which the session did not start.
 */
function turnsOn(prog: string, args: string[], verb: string): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action, word]) => command === "host" && action === verb && word !== "off",
  );
}

const endsAnOrphan = (prog: string, args: string[]) =>
  runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "resources" && action === "end-orphan",
  );

/** The `host` and `resources` verbs that are high from a shell, with what each is stopped for. */
export const HOST_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) => turnsOn(prog, args, "bypass"),
    reason: () =>
      "allows every session on the host to run without permission prompts, a choice the app leaves to the person and its enrolled device (flightdeckd host bypass on)",
  },
  {
    when: (prog, args) => turnsOn(prog, args, "updates"),
    reason: () =>
      "turns on the daemon's automatic update, which installs a new version and restarts the daemon by itself (flightdeckd host updates on)",
  },
  {
    when: endsAnOrphan,
    reason: () =>
      "ends a process of the host by its pid, one the session did not start (flightdeckd resources end-orphan)",
  },
];
