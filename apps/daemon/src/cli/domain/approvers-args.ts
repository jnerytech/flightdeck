/**
 * Issue #3476: what `flightdeckd approvers watch` takes, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names. `--follow` belongs to `approvers watch` only.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface ApproversArgs {
  command: string;
  action?: string;
  follow?: boolean;
}

/** The first thing wrong with the arguments, or undefined when there is none. */
export function approversProblem(args: ApproversArgs): string | undefined {
  if (args.follow && !(args.command === "approvers" && args.action === "watch"))
    return "--follow: this flag only applies to flightdeckd approvers watch";
  return undefined;
}
