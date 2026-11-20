/**
 * Issue #3456: what the `persona` verbs of the CLI take and need, checked before anything is sent. The
 * parser in `args.ts` adds the usage text to the problem this names.
 */

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
];

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface PersonaArgs {
  command: string;
  action?: string;
  scope?: string;
  personaName?: string;
  description?: string;
  body?: string;
  bodyFile?: string;
  model?: string;
  effort?: string;
  tools?: string[];
  permissionMode?: string;
  icon?: string;
  hash?: string;
  confirm?: boolean;
  projectPath?: string;
}

/** The flags of `persona`, each with the verbs that take it (`--language` is checked by the daemon). */
function personaFlags(args: PersonaArgs): Array<[string, unknown, readonly string[]]> {
  return [
    ["--scope", args.scope, ["list", "save", "remove"]],
    // `--name` and `--permission-mode` are also `history resume`'s: only `persona` is checked here.
    ...(args.command === "history"
      ? []
      : ([["--name", args.personaName, ["save"]]] as Array<[string, unknown, readonly string[]]>)),
    ["--body", args.body, ["save"]],
    ["--body-file", args.bodyFile, ["save"]],
    ["--model", args.model, ["save"]],
    ["--effort", args.effort, ["save"]],
    ["--tools", args.tools, ["save"]],
    ...(args.command === "history"
      ? []
      : ([["--permission-mode", args.permissionMode, ["save"]]] as Array<
          [string, unknown, readonly string[]]
        >)),
    ["--icon", args.icon, ["save"]],
    ["--hash", args.hash, ["trust"]],
    // `--description` and `--confirm` are the card's too: only `persona` is checked here.
    ...(args.command === "persona"
      ? ([
          ["--description", args.description, ["save"]],
          ["--confirm", args.confirm, ["publish-agent"]],
        ] as Array<[string, unknown, readonly string[]]>)
      : []),
  ];
}

/** What is wrong with the `persona` flags: a flag of another verb, or one the verb cannot do without. */
export function personaProblem(args: PersonaArgs): string | undefined {
  for (const [flag, value, verbs] of personaFlags(args)) {
    if (value === undefined) continue;
    // `team new --name` is the team's name, checked by `teamProblem`.
    if (flag === "--name" && args.command === "team") continue;
    if (args.command !== "persona" || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd persona ${verbs.join(", ")}`;
  }
  if (args.command !== "persona") return undefined;
  if (args.action === "save" || args.action === "remove") {
    if (args.scope === undefined) return "missing --scope";
    if (args.scope === "all") return "--scope: host or project";
  }
  if (args.action === "save") {
    if (args.personaName === undefined) return "missing --name";
    if (args.description === undefined) return "missing --description";
    if (args.body === undefined && args.bodyFile === undefined)
      return "missing --body or --body-file";
    if (args.body !== undefined && args.bodyFile !== undefined)
      return "--body or --body-file, not both";
  }
  if (
    (args.action === "publish-agent" || args.action === "trust") &&
    args.projectPath === undefined
  )
    return "missing --project-path";
  if (args.action === "trust" && args.hash === undefined) return "missing --hash";
  return undefined;
}
