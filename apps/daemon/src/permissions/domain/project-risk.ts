import { runsCliVerb } from "./shell-call.ts";

/**
 * `project add` and `update` set a project's setup script (a shell command that runs in every card), its
 * auto-approval and its prompt; `harness-export` copies its instructions into the host's shared store and
 * `harness-draft` runs a model over the repository (#3515). The app has the person fill a form and press a
 * button; from a shell, any session could widen what the next card runs or is allowed to do.
 */
const changesAProject = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "project", ["add", "update", "harness-draft", "harness-export"]);

/**
 * `project harness-apply` writes hooks (a command that runs in every session of a trusted project), deny rules
 * and instructions into the project's own files, and `harness-commit` puts them on a new branch (#3515). The app
 * has the person read the preview and confirm; from a shell, `--confirm` is only a typed flag, so a session could
 * plant a hook and then commit it.
 */
const writesAProjectSetup = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "project", ["harness-apply", "harness-commit"]);

/**
 * `project clone` runs `git` on an address the session gave and writes a folder inside an allowed root (#3737).
 * The app has the person read and confirm it; from a shell, `--confirm` is only a typed flag. `project scan` reads
 * the allowed folders and is not stopped.
 */
const clonesARepository = (prog: string, args: string[]) =>
  runsCliVerb(prog, args, "project", ["clone"]);

/** The `project` verbs that are high from a shell, each with what it is stopped for. */
export const PROJECT_RULES: Array<{
  when: (prog: string, args: string[]) => boolean;
  reason: (prog: string) => string;
}> = [
  {
    when: changesAProject,
    reason: () =>
      "sets what a project runs or allows without the person confirming it in the app: its setup script, its auto-approval, or the instructions it exports to the shared store, and a drafted CLAUDE.md is a model call (flightdeckd project add, update, harness-draft or harness-export)",
  },
  {
    when: writesAProjectSetup,
    reason: () =>
      "writes hooks, deny rules and instructions into a project's own files, or commits them on a new branch, which the app has the person read and confirm first; a typed --confirm is not the person (flightdeckd project harness-apply or harness-commit)",
  },
  {
    when: clonesARepository,
    reason: () =>
      "clones a repository from an address the session gave into a folder on the host, which the app has the person read and confirm first; a typed --confirm is not the person (flightdeckd project clone)",
  },
];
