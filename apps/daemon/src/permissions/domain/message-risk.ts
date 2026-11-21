import { runsCliVerb } from "./shell-call.ts";

/**
 * `message rules-set` replaces the rules that decide which sessions may message each other, and frees the
 * pairs a loop guard paused (#3622). The app has the person read the rules and save them; from a shell,
 * `--confirm` is only a typed word, so a session could open a path to another session or lift the loop
 * guard that stopped it. `history`, `watch` and `rules` only read, so they stay ordinary.
 */
const rewritesMessageRules = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "message", ["rules-set"]);

/** The `message` verbs that are high from a shell, each with what it is stopped for. */
export const MESSAGE_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: rewritesMessageRules,
    reason: () =>
      "rewrites the rules that decide which sessions may message each other, and frees paused pairs, without the person in the app; a typed --confirm is not the person (flightdeckd message rules-set)",
  },
];
