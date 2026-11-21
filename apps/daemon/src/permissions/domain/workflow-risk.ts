import { isExpanded, runsCliVerb, runsFlightdeckWords } from "./shell-call.ts";

/**
 * The `workflow` verbs that write (#3628). `trust` lets the file's shell commands run on the host, `template-add`
 * puts a branch and a PR into the project, and `resume --confirm` runs the project's commands again; the app asks
 * the person for each, and from a shell the hash and `--confirm` are only typed words (#3439), so all three are
 * high. A resume without `--confirm` only checks, and stays ordinary. A word the shell expands could be the flag,
 * so it counts as `--confirm`.
 */
const resumesForReal = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "workflow", ["resume"]) &&
  runsFlightdeckWords(
    prog,
    args,
    ([command, action], own) =>
      command === "workflow" &&
      action === "resume" &&
      own.some((word) => word === "--confirm" || isExpanded(word)),
  );

/** The `workflow` verbs that are high from a shell, with what each is stopped for. */
export const WORKFLOW_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) => runsCliVerb(prog, args, "workflow", ["trust"]),
    reason: () =>
      "lets a workflow's shell commands run on the host: trusting a hash is what the app asks the person for, and from a shell it is only a typed word (flightdeckd workflow trust)",
  },
  {
    when: (prog, args) => runsCliVerb(prog, args, "workflow", ["template-add"]),
    reason: () =>
      "commits a workflow template on a new branch of the project and opens its PR, which the app asks the person to confirm (flightdeckd workflow template-add)",
  },
  {
    when: resumesForReal,
    reason: () =>
      "runs a failed workflow run's project commands again from its failed step, which the app asks the person to confirm (flightdeckd workflow resume --confirm)",
  },
];
