import { runsCliVerb, unquoted } from "./shell-call.ts";

/**
 * A session putting the files of its own checkout back from a shell (#3701): `rewind apply` goes back to an
 * earlier turn and `rewind undo` to the state before the last rewind. The app does either only after the person
 * has read the files and confirmed in its dialog; from a shell, `--confirm` is only a typed flag. `rewind preview`
 * reads.
 */
const rewindsACheckout = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "rewind", onlyPreviews(args) ? ["apply"] : ["apply", "undo"]);

/**
 * `rewind undo <id> --preview` (#4041) only lists the files an undo would change. It is read when `--preview`
 * stands alone and no word is `--confirm`: with one, the line is rated as the undo it may be, whatever the
 * parser then does with the pair (`--host --preview` makes `--preview` a value, and `--confirm` still undoes).
 * Checked on the words first, so the line is walked for its CLI starts once.
 */
function onlyPreviews(args: string[]): boolean {
  const words = args.map(unquoted);
  return words.includes("--preview") && !words.some((word) => word.startsWith("--confirm"));
}

/** The `rewind` verbs that are high from a shell, with what they are stopped for. */
export const REWIND_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: rewindsACheckout,
    reason: () =>
      "puts the files of a session's checkout back to an earlier turn, or to the state before the last rewind, which the app does only after the person has read the files and confirmed in its dialog; a typed --confirm is not the person (flightdeckd rewind apply or undo)",
  },
];
