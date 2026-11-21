import { runsFlightdeckWords } from "./shell-call.ts";

/**
 * A review sent from a shell (#3619): `review send` turns the drafted comments of a target into one message in
 * its session, card or terminal. The app sends it when the person presses Send review; from a shell, `--confirm`
 * is only a typed flag. `list` and the changes to the drafts (`add`, `update`, `remove`) send nothing: the
 * person sees the drafts before pressing Send review.
 */
function sendsAReview(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "review" && action === "send",
  );
}

/** The `review` verb that is high from a shell, with what it is stopped for. */
export const REVIEW_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: sendsAReview,
    reason: () =>
      "puts the drafted review comments into a session, a card or a terminal as a message, which the app sends only when the person presses Send review (flightdeckd review send)",
  },
];
