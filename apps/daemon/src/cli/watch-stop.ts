import type { CliArgs } from "./domain/cli-args.ts";

/**
 * A `watch` runs until Ctrl-C (or a stop of the process) and writes as the changes come. Only the
 * stream listens: elsewhere Ctrl-C keeps its default, which ends the process. A `session teleport` listens
 * too (#3704): its Ctrl-C frees both hosts before the process ends.
 */
export function watchStop(
  args: CliArgs,
  deps: { onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void },
): AbortController {
  const stop = new AbortController();
  const listens =
    args.action === "watch" ||
    args.action === "follow" ||
    (args.command === "session" && args.action === "teleport");
  if (listens)
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      deps.onSignal(signal, async () => stop.abort());
  return stop;
}

/** What a `watch` is given to run: the stop above and a writer for each line as it comes. */
export function liveStream(
  args: CliArgs,
  deps: {
    onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
    log: { log(line: string): void };
  },
): { signal: AbortSignal; write: (line: string) => void } {
  return { signal: watchStop(args, deps).signal, write: (line) => deps.log.log(line) };
}
