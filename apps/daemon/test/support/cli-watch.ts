import type { CliResult } from "../../src/daemon-client/index.ts";
import { config, type fakeDaemon } from "../board/card-cli-helpers.ts";
import { poll } from "./helpers.ts";

export interface WatchOptions {
  timeoutMs?: number;
  /** Ctrl-C is pressed once this many lines came (default 1). */
  lines?: number;
  /** Runs once the daemon has the watch: pushes the frames. */
  after?: () => unknown;
}

/** What a `watch` command is run with: the stop, the line sink and the time limit of the connect. */
export interface WatchRun {
  signal: AbortSignal;
  write: (line: string) => void;
  timeoutMs: number;
}

/**
 * Runs a `watch` command once the daemon has `request`, lets `after` push its frames, then presses
 * Ctrl-C when `lines` lines came; gives the result and the lines written.
 */
export async function watchedCli(
  daemon: ReturnType<typeof fakeDaemon>,
  request: string,
  run: (cfg: ReturnType<typeof config>, options: WatchRun) => Promise<CliResult>,
  options: WatchOptions = {},
): Promise<{ result: CliResult; lines: string[] }> {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = run(config(daemon.port), {
    signal: stop.signal,
    write: (line) => lines.push(line),
    timeoutMs: options.timeoutMs ?? 2000,
  });
  await poll(() => daemon.calls.some((c) => c.type === request));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}
