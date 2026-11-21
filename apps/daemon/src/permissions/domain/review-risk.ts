import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * A review changed or sent from a shell (#3619). `send` turns the drafted comments of a target into one message in
 * its session, card or terminal; the app sends it when the person presses Send review, and from a shell `--confirm`
 * is only a typed flag. `update` and `remove` act on any comment by its id, so a session could rewrite or erase a
 * draft the person wrote, and the person's Send review would carry the session's words (security review,
 * 2026-11-21). `list` and `add` send nothing and leave the person's drafts as they are.
 */
const reviewVerb =
  (verbs: string[]) =>
  (prog: string, args: string[]): boolean =>
    runsFlightdeckWords(
      prog,
      args,
      ([command, action]) => command === "review" && verbs.includes(action ?? ""),
    );

/** The `review` verb that is high from a shell, with what it is stopped for. */
export const REVIEW_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: reviewVerb(["send"]),
    reason: () =>
      "puts the drafted review comments into a session, a card or a terminal as a message, which the app sends only when the person presses Send review (flightdeckd review send)",
  },
  {
    when: reviewVerb(["update", "remove"]),
    reason: () =>
      "rewrites or deletes a review comment, which may be one the person wrote or already sent, so what the person later sends with Send review can carry a session's words (flightdeckd review update|remove)",
  },
];
