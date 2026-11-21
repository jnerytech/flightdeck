import { runsFlightdeckWords } from "./shell-call.ts";

const CHANGES = new Set(["save", "enable", "remove"]);

/**
 * `automation save` writes what fires on its own, `enable` lets it fire and `remove` deletes it and its
 * runs (#3627): a session must not do any of them for the person, who reads the trigger and the action in
 * the app first. `--confirm` is only a flag the caller types, so it proves nothing. `disable` only stops an
 * automation and the reads (`list`, `runs`) change nothing: they stay ordinary shell commands.
 */
function changesAnAutomation(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "automation" && CHANGES.has(action ?? ""),
  );
}

/** The `automation` verbs that are high from a shell, with what each is stopped for. */
export const AUTOMATION_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesAnAutomation,
    reason: () =>
      "saves, turns on or removes an automation of a project, which then fires on its own without the person choosing it in the app (flightdeckd automation save, enable or remove)",
  },
];
