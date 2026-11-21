/**
 * Issue #3736: `flightdeckd activity since <time>`, what finished, reached review, merged or failed on a host since
 * a time, from a terminal (the "While you were away" of Needs you). Read-only. Exit codes: 0 done, 1 refused,
 * 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { type ActivityCliArgs, activityJson, activityLines } from "./domain/activity-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runActivityCli(
  args: ActivityCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-activity",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const result = await daemon.call("activity.since", {
        since: args.since,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
      return args.json ? json(activityJson(result)) : said(...activityLines(result));
    },
  });
}
