import type { CliArgs } from "./domain/cli-args.ts";
import { accountRun, daemonLifeRun, githubRun, resourcesRun, workflowRun } from "./domain-runs.ts";
import { externalRun, namesRun } from "./external-run.ts";
import { feedCommands } from "./feed-run.ts";
import type { HostCommandDeps } from "./host.ts";
import { liveStream } from "./watch-stop.ts";

type Run = ReturnType<typeof namesRun>;
type Deps = Parameters<typeof liveStream>[1];

/**
 * `update`: `check` and `apply` ask the daemon of this machine (#3780), and with no verb it is the install of a local file,
 * which asks none. `commands.ts` calls it from its one `update` line.
 */
export const updateCommand = <D extends HostCommandDeps>(
  args: CliArgs,
  deps: D,
  asking: (args: CliArgs, deps: D, run: Run) => Promise<number>,
): Promise<number> =>
  args.action === undefined
    ? import("./host.ts").then((host) => host.runUpdateCommand(args, deps))
    : asking(args, deps, daemonLifeRun(args));

/**
 * The commands that only ask a daemon, given the `asking` of `commands.ts` (which is at the size limit): `account`,
 * `external`, `github`, `names`, `resources`, `workflow` and the feeds (`logs`, `releases`, `alert` and `activity`). Each domain loads only when its verb runs (cli-startup test).
 */
export const daemonRuns = <D extends Deps>(
  asking: (args: CliArgs, deps: D, run: Run) => Promise<number>,
) => ({
  ...feedCommands(asking),
  account: (args: CliArgs, deps: D) => asking(args, deps, accountRun(args, liveStream(args, deps))),
  daemon: (args: CliArgs, deps: D) => asking(args, deps, daemonLifeRun(args)),
  external: (args: CliArgs, deps: D) =>
    asking(args, deps, externalRun(args, liveStream(args, deps))),
  github: (args: CliArgs, deps: D) => asking(args, deps, githubRun(args)),
  names: (args: CliArgs, deps: D) => asking(args, deps, namesRun(args)),
  resources: (args: CliArgs, deps: D) => asking(args, deps, resourcesRun(args)),
  workflow: (args: CliArgs, deps: D) =>
    asking(args, deps, workflowRun(args, liveStream(args, deps))),
});
