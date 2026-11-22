import { runsCliVerb } from "./shell-call.ts";

/**
 * Moving a session to another host, from a shell (#3704). `session teleport` sends a session's transcript and its
 * code to another host, which runs it there, and archives the copy on this one. A session that could start it
 * could carry what it holds, secrets included, to a host the person did not choose.
 */
export const TELEPORT_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    // `runsCliVerb` skips a runner's text that never names `session` (#3566): a line of thousands of CLI starts stays fast.
    when: (prog, args) => runsCliVerb(prog, args, "session", ["teleport"]),
    reason: () =>
      "moves a session, its transcript and its code, to another host, and archives it on this one (flightdeckd session teleport)",
  },
];
