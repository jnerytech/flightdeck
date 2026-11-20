/**
 * Issue #3454: `flightdeckd board settings|watch`, the host-wide board from a terminal or a script.
 * It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the token of
 * the config). Exit codes: 0 done, 1 refused, 2 no daemon. `watch` is a stream
 * (docs/decisions/2026-11-20-cli-streams.md): it runs until Ctrl-C.
 */
import {
  type CliResult,
  json,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import { type BoardCliArgs, settingsLine, UNSURE, watchLine } from "./domain/board-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export async function runBoardCli(
  args: BoardCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  const { maxParallelRuns } = args;
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-board",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Only a change can leave its result unknown; a read has nothing to say.
    unsure: maxParallelRuns === undefined ? "" : UNSURE,
    perform: async (daemon, note, flow) => {
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal ?? new AbortController().signal,
          write: options.write ?? (() => undefined),
          open: () => daemon.call("board.watch", {}),
          type: "card.updated",
          line: ({ card }) => (args.json ? JSON.stringify(card) : watchLine(card)),
        });
      note.wrote = maxParallelRuns !== undefined;
      const settings = await daemon.call(
        "board.settings",
        maxParallelRuns === undefined ? {} : { maxParallelRuns },
      );
      return args.json ? json(settings) : said(settingsLine(settings));
    },
  });
}
