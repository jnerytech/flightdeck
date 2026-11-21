import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { activityCliArgs, alertCliArgs, logsCliArgs, releasesCliArgs } from "./domain/feed-args.ts";

type Runner = (
  config: { bind: string; port: number; token: string },
  remote?: RemoteTarget,
) => Promise<CliResult>;

/**
 * What `logs tail`, `releases list`, `alert list` and `activity since` run once `asking` has the daemon's config (or
 * the paired host's). Each domain loads only when its verb runs (cli-startup test). It lives apart from `commands.ts`,
 * which is at the size limit.
 */
const feedRun =
  (args: CliArgs): Runner =>
  async (config, remote) => {
    const options = remote ? { remote } : {};
    if (args.command === "logs")
      return (await import("../logs/index.ts")).runLogsCli(logsCliArgs(args), config, options);
    if (args.command === "releases")
      return (await import("../releases/index.ts")).runReleasesCli(
        releasesCliArgs(args),
        config,
        options,
      );
    if (args.command === "alert")
      return (await import("../github/index.ts")).runAlertCli(alertCliArgs(args), config, options);
    return (await import("../activity/index.ts")).runActivityCli(
      activityCliArgs(args),
      config,
      options,
    );
  };

/** The four commands for the table of `commands.ts`, given its `asking`. */
export const feedCommands = <D>(
  asking: (args: CliArgs, deps: D, run: Runner) => Promise<number>,
) => {
  const feed = (args: CliArgs, deps: D) => asking(args, deps, feedRun(args));
  return { logs: feed, releases: feed, alert: feed, activity: feed };
};
