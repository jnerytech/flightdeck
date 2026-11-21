import { isExpanded, runsFlightdeckWords } from "./shell-call.ts";
import { READING_FLAGS } from "./watch-risk.ts";

/**
 * Whether the only change the words ask for is `--off`: turning the push off grants a session nothing. A word
 * the shell expands may be any flag (`--off $X` with `X=--on`), so it is never only that.
 */
const onlyTurnsOff = (own: string[]) => {
  if (own.some(isExpanded)) return false;
  const changes = own.filter((word) => word.startsWith("--") && !READING_FLAGS.includes(word));
  return changes.length === 1 && changes[0] === "--off";
};

/**
 * A change of a project's board sync from a shell (#3540): `link` ties the project to a GitHub Projects board
 * and pulls the board in as cards, `set-map` decides which board status is which column, `sync-now` pulls the
 * board again, and `set-push --on` sends the cards' moves to the board. The app has the person pick the board
 * and confirm the push; from a shell, `--confirm` is only a typed flag. `set-push` is read by what it is not:
 * a line that is not a lone `--off` is high. `unlink` and the reads (`boards`, `status`, `log`) grant nothing.
 */
function changesABoardSync(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action], own) => {
    if (command !== "boardsync") return false;
    if (action === "link" || action === "set-map" || action === "sync-now") return true;
    return action === "set-push" && !onlyTurnsOff(own);
  });
}

/** The `boardsync` verbs that are high from a shell, with what they are stopped for. */
export const BOARDSYNC_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesABoardSync,
    reason: () =>
      "links a project to a GitHub Project board, rewrites which board status is which column, pulls the board into the cards, or turns on pushing the cards' changes to it, none of which the app does without the person confirming it (flightdeckd boardsync link, set-map, sync-now or set-push --on)",
  },
];
