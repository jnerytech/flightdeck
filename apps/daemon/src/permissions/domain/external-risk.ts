import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * A text put into a terminal session from a shell (#3735). `external message` hands the text to the channel of a
 * session opened with `flightdeckd claude`, which takes it as the person's next prompt, with no sender, and a
 * session that runs in bypass mode acts on it without asking. It skips what `message send` applies (the access
 * rules, the loop guard, the size cap and the suspension of auto-approve after third-party text), so a session
 * that read hostile content could drive another, or its own, terminal (security review, 2026-11-21). `list` and
 * `watch` only read, and `names list` only reads.
 */
export const EXTERNAL_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) =>
      runsFlightdeckWords(
        prog,
        args,
        ([command, action]) => command === "external" && action === "message",
      ),
    reason: () =>
      "puts text into a terminal session as the person's next prompt, with no sender, no message rules and no loop guard (flightdeckd external message)",
  },
];
