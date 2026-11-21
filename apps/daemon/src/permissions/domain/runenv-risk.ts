import { runsFlightdeckWords } from "./shell-call.ts";

const RUNS = new Set(["trust", "start"]);

/**
 * `runenv trust` lets a project's run.yaml run, and `runenv start` runs its setup and processes on the
 * host (#3621): a session must not do either for the person, who reads the commands in the app first.
 * `--confirm` is only a flag the caller types, so it proves nothing. `stop` ends what runs and the
 * reads (`config`, `get`, `watch`) change nothing: they stay ordinary shell commands.
 */
function runsAProjectEnvironment(prog: string, args: string[]): boolean {
  return runsFlightdeckWords(
    prog,
    args,
    ([command, action]) => command === "runenv" && RUNS.has(action ?? ""),
  );
}

/** The `runenv` verbs that are high from a shell, with what each is stopped for. */
export const RUNENV_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: runsAProjectEnvironment,
    reason: () =>
      "trusts a project's run.yaml or runs its commands, without the person choosing it in the app (flightdeckd runenv trust or start)",
  },
];
