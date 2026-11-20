/**
 * Issue #3460: `flightdeckd costs summary|session|card|run|status|export`, what the host's sessions cost.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import {
  type CostsCliArgs,
  csvLines,
  sessionLines,
  statusLines,
  summaryLines,
  usd,
} from "./domain/costs-cli-view.ts";

export type { CostsCliArgs } from "./domain/costs-cli-view.ts";

export async function runCostsCli(
  args: CostsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-costs",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) => {
      const id = args.id ?? "";
      const filter = {
        from: args.from ?? "",
        to: args.to ?? "",
        ...(args.projectKey === undefined ? {} : { projectKey: args.projectKey }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.origin === undefined ? {} : { origin: args.origin }),
      };
      switch (args.action) {
        case "summary": {
          const summary = await daemon.call("costs.summary", filter);
          return args.json ? json(summary) : said(...summaryLines(summary));
        }
        case "export": {
          const exported = await daemon.call("costs.export", filter);
          return args.json ? json(exported) : said(...csvLines(exported.csv));
        }
        case "session": {
          const session = await daemon.call("costs.session", { claudeSessionId: id });
          return args.json ? json(session) : said(...sessionLines(session));
        }
        case "card": {
          const card = await daemon.call("costs.card", { cardId: id });
          return args.json ? json(card) : said(`card ${id}: ${usd(card.costUsd)}`);
        }
        case "run": {
          const run = await daemon.call("costs.run", { runId: id });
          return args.json ? json(run) : said(`run ${id}: ${usd(run.costUsd)}`);
        }
        default: {
          const status = await daemon.call("costs.status", {});
          return args.json ? json(status) : said(...statusLines(status));
        }
      }
    },
  });
}
