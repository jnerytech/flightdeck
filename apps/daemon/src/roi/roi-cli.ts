/**
 * Issue #3460: `flightdeckd roi`, what the agents cost and delivered in a period against the one before.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import { roiLines } from "./domain/roi-cli-view.ts";

export interface RoiCliArgs {
  from: string;
  to: string;
  projectKey?: string;
  json?: boolean;
}

export async function runRoiCli(
  args: RoiCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-roi",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const result = await daemon.call("roi.summary", {
        from: args.from,
        to: args.to,
        ...(args.projectKey === undefined ? {} : { projectKey: args.projectKey }),
      });
      return args.json ? json(result) : said(...roiLines(result));
    },
  });
}
