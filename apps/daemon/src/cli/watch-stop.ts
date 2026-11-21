import type { CliArgs } from "./domain/cli-args.ts";

/**
 * A `watch` runs until Ctrl-C (or a stop of the process) and writes as the changes come. Only the
 * stream listens: elsewhere Ctrl-C keeps its default, which ends the process.
 */
export function watchStop(
  args: CliArgs,
  deps: { onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void },
): AbortController {
  const stop = new AbortController();
  if (args.action === "watch" || args.action === "follow")
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      deps.onSignal(signal, async () => stop.abort());
  return stop;
}
