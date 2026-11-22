import { isExpanded, runsCliVerb, runsFlightdeckWords } from "./shell-call.ts";

/**
 * The task template and harness template verbs that start or delete something (#3738). `template start` opens a
 * Claude session whose prompt and permissions a template sets and the values fill in, which the app asks the person
 * to confirm; `harness templates delete` removes a template's folder from the host, and from a shell its `--confirm`
 * is only a typed word (#3439), so both are high. The reads (`template list`, `task results|preview` and `harness
 * templates list`) stay ordinary. A word the shell expands in the verb of `harness templates` could be `delete`.
 */
const deletesAHarnessTemplate = (prog: string, args: string[]) =>
  runsFlightdeckWords(
    prog,
    args,
    ([command, noun, verb]) =>
      command === "harness" && noun === "templates" && (verb === "delete" || isExpanded(verb)),
  );

/** The verbs of these domains that are high from a shell, with what each is stopped for. */
export const TEMPLATES_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: (prog, args) => runsCliVerb(prog, args, "template", ["start"]),
    reason: () =>
      "starts a Claude session on a task template, with a prompt filled from the values and permissions the template sets, which the app asks the person to confirm (flightdeckd template start)",
  },
  {
    when: deletesAHarnessTemplate,
    reason: () =>
      "deletes a saved harness template folder from the host, which the app asks the person to confirm and a shell reaches with only a typed flag (flightdeckd harness templates delete)",
  },
];
