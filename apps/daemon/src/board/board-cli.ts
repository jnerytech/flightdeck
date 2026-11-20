/**
 * Issue #3454: `flightdeckd board settings|watch`, the host-wide board from a terminal or a script.
 * It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the token of
 * the config). Exit codes: 0 done, 1 refused, 2 no daemon. `watch` is a stream
 * (docs/decisions/2026-11-20-cli-streams.md): it runs until Ctrl-C.
 */
import {
  type CliResult,
  type DaemonClient,
  json,
  plain,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { type BoardCliArgs, settingsLine, UNSURE, watchLine } from "./domain/board-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** The cards the daemon pushes, one line each, until `signal` aborts or the daemon goes away. */
async function watch(
  args: BoardCliArgs,
  daemon: DaemonClient,
  flow: { started(): void; hide(text: string): string },
  signal: AbortSignal,
  write: (line: string) => void,
): Promise<CliResult> {
  const stopped = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  // A terminal that cannot be written to (a closed pipe) ends the stream, it does not crash the socket handler.
  let unwritable!: (error: unknown) => void;
  const broken = new Promise<never>((_, reject) => {
    unwritable = reject;
  });
  const off = daemon.onFrame("card.updated", ({ card }) => {
    try {
      write(plain(flow.hide(args.json ? JSON.stringify(card) : watchLine(card))));
    } catch (error) {
      unwritable(error);
    }
  });
  try {
    // Ctrl-C counts from the first moment, also while the daemon has not answered yet.
    await Promise.race([daemon.call("board.watch", {}), stopped, broken, daemon.unreadable]);
    if (!signal.aborted) {
      flow.started();
      const gone = daemon.closed.then(() => {
        throw new Error("connection closed");
      });
      await Promise.race([stopped, gone, broken, daemon.unreadable]);
    }
    return { code: 0, out: [], err: [] };
  } finally {
    off();
  }
}

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
        return watch(
          args,
          daemon,
          flow,
          options.signal ?? new AbortController().signal,
          options.write ?? (() => undefined),
        );
      note.wrote = maxParallelRuns !== undefined;
      const settings = await daemon.call(
        "board.settings",
        maxParallelRuns === undefined ? {} : { maxParallelRuns },
      );
      return args.json ? json(settings) : said(settingsLine(settings));
    },
  });
}
