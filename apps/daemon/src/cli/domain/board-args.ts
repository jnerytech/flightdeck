/**
 * Issue #3454: what the `board` verbs of the CLI take, checked before anything is sent. The parser in
 * `args.ts` adds the usage text to the problem this names.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface BoardArgs {
  command: string;
  action?: string;
  maxParallelRuns?: number;
}

/** What is wrong with the arguments of a `board` command, or undefined when nothing is. */
export function boardProblem(args: BoardArgs): string | undefined {
  if (
    args.maxParallelRuns !== undefined &&
    !(args.command === "board" && args.action === "settings")
  )
    return "--max-parallel-runs: this flag only applies to flightdeckd board settings";
  return undefined;
}
