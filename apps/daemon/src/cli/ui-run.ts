import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { uiCliArgs } from "./domain/ui-args.ts";

/** What `ui set` runs once `asking` has the daemon's config; the `ui` domain loads only when the verb runs (cli-startup test). */
export const uiRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../ui/index.ts")).runUiCli(uiCliArgs(args), config, {
      ...(remote ? { remote } : {}),
    });
