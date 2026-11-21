import type { CliArgs } from "./domain/cli-args.ts";
import { externalRun, namesRun } from "./external-run.ts";
import { liveStream } from "./watch-stop.ts";
import { workflowRun } from "./workflow-run.ts";

type Run = ReturnType<typeof namesRun>;
type Deps = Parameters<typeof liveStream>[1];

/**
 * The commands that only ask a daemon, given the `asking` of `commands.ts` (which is at the size limit): `external`,
 * `names` and `workflow`. Each domain loads only when its verb runs (cli-startup test).
 */
export const daemonRuns = <D extends Deps>(
  asking: (args: CliArgs, deps: D, run: Run) => Promise<number>,
) => ({
  external: (args: CliArgs, deps: D) =>
    asking(args, deps, externalRun(args, liveStream(args, deps))),
  names: (args: CliArgs, deps: D) => asking(args, deps, namesRun(args)),
  workflow: (args: CliArgs, deps: D) =>
    asking(args, deps, workflowRun(args, liveStream(args, deps))),
});
