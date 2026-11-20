/**
 * Issue #3460: `flightdeckd usage`, what a host's managed sessions cost per day and project.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import { type UsageCliArgs, usageLines } from "./domain/usage-cli-view.ts";

export type { UsageCliArgs } from "./domain/usage-cli-view.ts";

export async function runUsageCli(
  args: UsageCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-usage",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const summary = await daemon.call(
        "usage.summary",
        args.days === undefined ? {} : { days: args.days },
      );
      return args.json ? json(summary) : said(...usageLines(summary));
    },
  });
}
