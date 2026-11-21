import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { workflowCliArgs } from "./domain/workflow-args.ts";

/**
 * What `workflow list|templates|validate|run|watch|resume` runs once `asking` has the daemon's config (or the paired
 * host's). `live` is what `watch` is given to stop and to write each line. The workflows domain loads only when the
 * verb runs (cli-startup test). It lives apart from `commands.ts`, which is at the size limit.
 */
export const workflowRun =
  (args: CliArgs, live: { signal: AbortSignal; write: (line: string) => void }) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../workflows/index.ts")).runWorkflowCli(workflowCliArgs(args), config, {
      ...(remote ? { remote } : {}),
      ...live,
    });

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
