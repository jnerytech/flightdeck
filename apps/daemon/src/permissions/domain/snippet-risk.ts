import { EXPANDS, isCliProgram, runsFlightdeckWords } from "./shell-call.ts";

/** The verbs that make the host keep or run something chosen by the caller: they are high however they are reached. */
const POWER = ["save", "trust", "use"];

/**
 * A session changing what a snippet makes the host run (#3615): `snippet save` writes a command the person
 * later types into a terminal with one key, `snippet trust` makes a project's versioned file runnable (a
 * session in that repo can write the file), and `snippet use` types a command into a terminal and, with
 * `--enter`, runs it. `import-history --select` turns shell history lines into snippets. The reads
 * (`list`, `get`, `render`, `parse`, `import-history` without `--select`) and the two that only
 * tidy up (`remove`, `favorite`) stay ordinary shell commands.
 *
 * A word the shell expands may be `--select` (`S=--select; fd snippet import-history $S abc`), and a
 * runner's words have lost their quotes, so there a `$`, a glob or a brace is the sign, as for `history resume` (#3570).
 */
export function changesASnippet(prog: string, args: string[]): boolean {
  const expands = (w: string) => (isCliProgram(prog) ? w.includes(EXPANDS) : /[$`*?[{]/.test(w));
  return runsFlightdeckWords(prog, args, ([command, action], own) => {
    if (command !== "snippet") return false;
    if (POWER.includes(action as string)) return true;
    return (
      action === "import-history" &&
      own.some((w) => w === "--select" || w.startsWith("--select=") || expands(w))
    );
  });
}
