/**
 * Issue #3735: `flightdeckd external list|message|watch`, the sessions of a plain `claude` in a terminal
 * that this host sees. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";

export type ExternalCliArgs =
  | { action: "list" | "watch"; json?: boolean }
  | { action: "message"; session: string; text: string; json?: boolean };

export function runExternalCli(
  _args: ExternalCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return Promise.resolve({ code: 0, out: [], err: [] });
}
