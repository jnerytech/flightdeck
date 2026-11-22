import { runsCliVerb } from "./shell-call.ts";

/**
 * How the host presents itself, from a shell (#3781). `ui set` changes the host's default mode and the lock on
 * the switch between Full and Simple, which the person set for whoever uses the app. A session that could change
 * it could lock the person out of the mode they work in, or unlock a host that was set up to stay simple.
 */
export const UI_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    // `runsCliVerb` skips a runner's text that never names `ui` (#3566): a line of thousands of CLI starts stays fast.
    when: (prog, args) => runsCliVerb(prog, args, "ui", ["set"]),
    reason: () =>
      "changes how the host presents itself to the person who uses its app, its default mode and the lock on it (flightdeckd ui set)",
  },
];
