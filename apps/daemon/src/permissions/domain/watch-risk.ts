import { isExpanded, runsFlightdeckWords } from "./shell-call.ts";

/** The flags that only choose the daemon or the output, and change nothing (`watch settings`, `boardsync set-push`). */
const READING_FLAGS = new Set(["--json", "--host", "--config"]);

/**
 * Whether the only change the words ask for is `off` (`--disable` for a watch, `--off` for a board push): turning
 * something off grants a session nothing. A word the shell expands may be any flag (`--disable $X` with
 * `X='--check evil'`), so it is never only that.
 */
export const onlyTurnsOff = (own: string[], off: string) => {
  if (own.some(isExpanded)) return false;
  const changes = own.filter((word) => word.startsWith("--") && !READING_FLAGS.has(word));
  return changes.length === 1 && changes[0] === off;
};

/**
 * A change of a card's PR watch from a shell (#3539): `watch set --enable|--default` and a `settings`
 * flag decide whether Claude is woken on its own against a PR and what it may spend, `extend` gives a
 * card more rounds, and `resolve-held --push` publishes a round's commits. A flag is read by what it is
 * not (a flag outside the three that read), so a flag a later version adds, or one typed as `--x=y`,
 * is high too. Turning a watch off and dropping a held round are ordinary shell commands: they end work
 * and grant nothing. The reads (`get`, `trace`, `describe`, `by-url`) change nothing.
 */
export function changesAWatch(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(prog, args, ([command, action], own) => {
    if (command !== "watch") return false;
    if (action === "extend") return true;
    if (action === "set") return !onlyTurnsOff(own, "--disable");
    if (action === "settings")
      return (
        own.some((w) => w.startsWith("--") && !READING_FLAGS.has(w)) &&
        !onlyTurnsOff(own, "--disable")
      );
    if (action === "resolve-held")
      return !(
        own.includes("--drop") &&
        !own.some((w) => w.startsWith("--push")) &&
        !own.some(isExpanded)
      );
    return false;
  });
}
