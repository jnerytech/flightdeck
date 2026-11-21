import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { MessageAdminCliArgs } from "../messaging/index.ts";

/**
 * What `message history|watch|rules` runs once `asking` has the daemon's config (or the paired host's). `watch` runs
 * until Ctrl-C or a termination request; the other two keep the default Ctrl-C, which ends the process. The messaging
 * service loads only when the verb runs: a hook, or a verb of another noun, starts without it (cli-startup test).
 */
export function messageAdminRun(
  admin: MessageAdminCliArgs,
  deps: {
    onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
    log: { log(line: string): void };
  },
) {
  const stop = new AbortController();
  if (admin.action === "watch")
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      deps.onSignal(signal, async () => stop.abort());
  return async (
    config: Parameters<typeof import("../messaging/index.ts").runMessageAdminCli>[1],
    remote?: RemoteTarget,
  ): Promise<CliResult> =>
    (await import("../messaging/index.ts")).runMessageAdminCli(admin, config, {
      ...(remote ? { remote } : {}),
      signal: stop.signal,
      write: (line) => deps.log.log(line),
    });
}
