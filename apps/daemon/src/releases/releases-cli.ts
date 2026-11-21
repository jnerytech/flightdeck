/**
 * Issue #3736: `flightdeckd releases list`, the latest releases of the app with the highlights of each, from a
 * terminal. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { type ReleasesCliArgs, releasesJson, releasesLines } from "./domain/releases-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runReleasesCli(
  args: ReleasesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-releases",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { releases } = await daemon.call(
        "releases.list",
        args.limit === undefined ? {} : { limit: args.limit },
      );
      return args.json ? json(releasesJson(releases)) : said(...releasesLines(releases));
    },
  });
}
