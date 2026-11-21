/**
 * Issue #3457: what the `rules` and `autoapprove` verbs of the CLI take and need, checked before anything
 * is sent. The parser in `args.ts` adds the usage text to the problem this names. A removal and a resume
 * are the app's confirmed changes: `--confirm` is required here, as the daemon requires it too.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface RulesArgs {
  command: string;
  action?: string;
  project?: string;
  session?: string;
  limit?: number;
  rule?: string;
  confirm?: boolean;
}

/** `rules list` takes no `--confirm`; `rules remove` cannot go without it. */
function rulesCommandProblem(args: RulesArgs): string | undefined {
  if (args.action === "list")
    return args.confirm
      ? "--confirm: this flag only applies to flightdeckd rules remove"
      : undefined;
  return args.confirm
    ? undefined
    : `rules remove cannot be undone: pass --confirm to do it (the rule is ${args.rule ?? ""})`;
}

/** `autoapprove list` takes no `--confirm`; `autoapprove resume` needs its session and `--confirm`. */
function autoapproveProblem(args: RulesArgs): string | undefined {
  if (args.action === "list")
    return args.confirm
      ? "--confirm: this flag only applies to flightdeckd autoapprove resume"
      : undefined;
  if (args.project !== undefined)
    return "--project: this flag only applies to flightdeckd autoapprove list";
  if (args.limit !== undefined)
    return "--limit: this flag only applies to flightdeckd autoapprove list";
  if (args.session === undefined) return "missing --session: the session whose approval resumes";
  return args.confirm
    ? undefined
    : `autoapprove resume cannot be undone: pass --confirm to do it (the session is ${args.session})`;
}

/** The first thing wrong with the arguments of `rules` or `autoapprove`, or undefined when there is none. */
export function rulesProblem(args: RulesArgs): string | undefined {
  if (args.command === "rules") return rulesCommandProblem(args);
  if (args.command === "autoapprove") return autoapproveProblem(args);
  return undefined;
}
