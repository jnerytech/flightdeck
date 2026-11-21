import { runsCliVerb } from "./shell-call.ts";

/**
 * A session controlling the background sessions of its host from a shell (#3734). `bg start` runs a new Claude
 * with a prompt the person did not read in the app, `bg message` can resume a stopped session with any text,
 * which is `bg start` by another route, and `bg stop` and `bg respawn` end or replace a session that may be
 * mid-work. The daemon checks the folder, the trust and the worktree, but not who asked. `bg list` reads. The rule
 * sees only the command line, so it rates a verb however its text is reached.
 */
const controlsABackgroundSession = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "bg", ["start", "stop", "respawn", "message"]);

/** The `bg` verbs that are high from a shell, with what they are stopped for. */
export const BG_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: controlsABackgroundSession,
    reason: () =>
      "starts, stops, restarts or writes into a background session of the host: `bg start` runs a new Claude with a prompt the person did not read in the app, `bg message` can resume a stopped session with any text, which is `bg start` by another route, and `bg stop` and `bg respawn` end or replace a session that may be mid-work (flightdeckd bg start, stop, respawn or message)",
  },
];
