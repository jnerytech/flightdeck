/**
 * Issue #3460: `flightdeckd costs summary|session|card|run|status|export`, what the host's sessions cost.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, shown } from "../daemon-client/index.ts";
import {
  type CostsCliArgs,
  csvLines,
  sessionLines,
  statusLines,
  summaryLines,
  UNSURE_REPRICE,
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
    ...(args.action === "reprice" ? { unsure: UNSURE_REPRICE } : {}),
    perform: async (daemon, note) => {
      const id = args.id ?? "";
      switch (args.action) {
        case "summary":
          return shown(args.json, await daemon.call("costs.summary", filterOf(args)), (summary) =>
            summaryLines(summary),
          );
        case "export":
          return shown(args.json, await daemon.call("costs.export", filterOf(args)), (exported) =>
            csvLines(exported.csv),
          );
        case "session":
          return shown(
            args.json,
            await daemon.call("costs.session", { claudeSessionId: id }),
            sessionLines,
          );
        case "card":
          return shown(args.json, await daemon.call("costs.card", { cardId: id }), (card) => [
            `card ${id}: ${usd(card.costUsd)}`,
          ]);
        case "run":
          return shown(args.json, await daemon.call("costs.run", { runId: id }), (run) => [
            `run ${id}: ${usd(run.costUsd)}`,
          ]);
        case "reprice": {
          note.wrote = true;
          return shown(args.json, await daemon.call("costs.reprice", {}), repricedLine);
        }
        default:
          return shown(args.json, await daemon.call("costs.status", {}), statusLines);
      }
    },
  });
}

/** The window and the filters the person typed, as the daemon's cost queries take them. */
function filterOf(args: CostsCliArgs) {
  return {
    from: args.from ?? "",
    to: args.to ?? "",
    ...(args.projectKey === undefined ? {} : { projectKey: args.projectKey }),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.origin === undefined ? {} : { origin: args.origin }),
  };
}

/** What a reprice printed: the entries it changed. */
const repricedLine = (repriced: { entries: number }) => [
  `repriced ${repriced.entries} ${repriced.entries === 1 ? "entry" : "entries"} with the price table of the config`,
];
