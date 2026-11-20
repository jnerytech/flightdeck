/**
 * Issue #3454: `flightdeckd board settings`, the host-wide board settings from a terminal or a
 * script. It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the
 * token of the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import { type BoardCliArgs, settingsLine, UNSURE } from "./domain/board-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runBoardCli(
  args: BoardCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const { maxParallelRuns } = args;
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-board",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Only a change can leave its result unknown; a read has nothing to say.
    unsure: maxParallelRuns === undefined ? "" : UNSURE,
    perform: async (daemon, note) => {
      note.wrote = maxParallelRuns !== undefined;
      const settings = await daemon.call(
        "board.settings",
        maxParallelRuns === undefined ? {} : { maxParallelRuns },
      );
      return args.json ? json(settings) : said(settingsLine(settings));
    },
  });
}
