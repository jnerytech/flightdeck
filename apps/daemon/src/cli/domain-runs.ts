import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { CliArgs } from "./domain/cli-args.ts";
import { harnessCliArgs, templatesCliArgs } from "./domain/templates-args.ts";
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
      {
        ...(args.json ? { json: true } : {}),
        ...(args.action === "pause-at" || args.action === "end-orphan"
          ? {
              action: args.action,
              ...(args.resourcesPauseAt !== undefined ? { pauseAt: args.resourcesPauseAt } : {}),
              ...(args.orphanPid !== undefined ? { pid: args.orphanPid } : {}),
              ...(args.orphanTicks !== undefined ? { startTicks: args.orphanTicks } : {}),
            }
          : {}),
      },
      config,
      remote ? { remote } : {},
    );

/**
 * What `template list|start` and `task results|preview` run once `asking` has the daemon's config (or the paired
 * host's). The templates domain loads only when the verb runs (cli-startup test).
 */
export const templatesRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../templates/index.ts")).runTemplatesCli(
      templatesCliArgs(args),
      config,
      remote ? { remote } : {},
    );

/** What `harness templates list|delete` run once `asking` has the daemon's config (or the paired host's). */
export const harnessRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../harness/index.ts")).runHarnessCli(
      harnessCliArgs(args),
      config,
      remote ? { remote } : {},
    );

/**
 * What `update check|apply` and `daemon stop` run once `asking` has the config of this machine's daemon (#3780): a
 * `--host` is refused by the parser, so the paired host's target is never given. Each domain loads only when its
 * verb runs (cli-startup test).
 */
export const daemonLifeRun =
  (args: CliArgs) =>
  async (
    config: { bind: string; port: number; token: string },
    _remote?: RemoteTarget,
  ): Promise<CliResult> => {
    const json = args.json ? { json: true as const } : {};
    if (args.command === "daemon")
      return (await import("../service/index.ts")).runDaemonStopCli(json, config);
    return (await import("../updates/index.ts")).runUpdateCli(
      { action: args.action as "check" | "apply", ...json },
      config,
    );
  };
