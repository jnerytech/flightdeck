import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";

/**
 * What `resources` runs once `asking` has the daemon's config (or the paired host's). The resources domain loads
 * only when the verb runs (cli-startup test). It lives apart from `commands.ts`, which is at the size limit.
 */
export const resourcesRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../resources/index.ts")).runResourcesCli(
      args.json ? { json: true } : {},
      config,
      remote ? { remote } : {},
    );
