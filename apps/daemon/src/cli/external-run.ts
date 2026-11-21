import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { externalCliArgs, namesCliArgs } from "./domain/external-args.ts";

/**
 * What `external list|message|watch` and `names list` run once `asking` has the daemon's config (or the paired
 * host's). The `central` and `names` domains load only when the verb runs: a hook, or a verb of another noun,
 * starts without them (cli-startup test). They live apart from `commands.ts`, which is at the size limit.
 * `live` is the stop and the sink of a `watch` (`liveStream`).
 */
export const externalRun =
  (args: CliArgs, live: { signal?: AbortSignal; write?: (line: string) => void }) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../central/index.ts")).runExternalCli(externalCliArgs(args), config, {
      ...(remote ? { remote } : {}),
      ...live,
    });

export const namesRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../names/index.ts")).runNamesCli(namesCliArgs(args), config, {
      ...(remote ? { remote } : {}),
    });
