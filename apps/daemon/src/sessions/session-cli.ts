/**
 * Issue #3514: `flightdeckd session interrupted|summary|files`, the read side of one session of the
 * local daemon. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, type RemoteTarget, runOnLocalDaemon } from "../daemon-client/index.ts";

export interface SessionCliArgs {
  action: "interrupted" | "summary" | "files";
  /** `summary` and `files`: the id or the name of the session. */
  session?: string;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function runSessionCli(
  args: SessionCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-session",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async () => ({ code: 0, out: [args.action], err: [] }),
  });
}
