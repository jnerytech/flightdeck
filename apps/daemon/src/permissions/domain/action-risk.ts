import { runsFlightdeckWords } from "./shell-call.ts";

const CHANGES = new Set(["save", "trust", "remove"]);

/**
 * `action save` declares a command that runs with secrets in its environment, and the daemon trusts what is
 * saved this way as it is saved; `trust` lets a versioned command run; `remove` deletes one (#3629). A session
 * must not do any of them without the person: the prompt shows the command line and, for `save`, what the definition file holds (`./action-save-view.ts`, #3752), so the person sees what will run. `--hash` is only a flag the
 * caller types, so it proves nothing (#3439). The reads (`list`, `runs`) change nothing, and `run` is the
 * `flightdeck` mod's own way to start a trusted action: they stay ordinary shell commands.
 */
function changesAnAction(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "action" && CHANGES.has(action ?? ""),
  );
}

/** The `action` verbs that are high from a shell, with what each is stopped for. */
export const ACTION_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesAnAction,
    reason: () =>
      "saves, trusts or removes an action: a saved action is trusted as it is saved and then runs with its secrets, and a trusted one may run, without the person choosing it in the app (flightdeckd action save, trust or remove)",
  },
];
