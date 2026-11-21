import { runsCliVerb } from "./shell-call.ts";

/**
 * `logs tail` gives a session the daemon's own log: its paths, its hosts and whatever the redaction missed, which the
 * session was never given (#3736). `releases list`, `alert list` and `activity since` read what the app already
 * shows the person, so they stay ordinary.
 */
const readsLog = (prog: string, args: string[]) => runsCliVerb(prog, args, "logs", ["tail"]);

/** The `logs` verbs that are high from a shell, each with what it is stopped for. */
export const LOGS_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: readsLog,
    reason: () =>
      "reads the daemon's own log, which holds paths and whatever the redaction missed, so a session could read what it was never given (flightdeckd logs tail)",
  },
];
