import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * `flightdeckd send <session> <text>` puts the text into the session as the input box does: the session reads it
 * as the person, it may run with `bypassPermissions`, the card's check loop counts it as the person's turn, and
 * `--host` reaches other hosts (#3762). A session that must talk to another has `message send`, under the rules of
 * which sessions may message each other. `send` is a common word, so it counts only as the command's own first
 * word, not anywhere in a runner's text (`review send`, `message send`). Like `approve`, this reads the command
 * text: the daemon cannot tell who holds the shell.
 */
const writesAsThePerson = (prog: string, args: string[]) =>
  runsFlightdeckWords(prog, args, ([first]) => first === "send");

/** The top-level `flightdeckd` commands that are high from a shell, with what each is stopped for. */
export const SEND_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: writesAsThePerson,
    reason: () =>
      "puts a text into a session as the person's own input, and steps the card's check loop aside (flightdeckd send)",
  },
];
