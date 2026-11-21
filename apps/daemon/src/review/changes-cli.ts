/**
 * Issue #3620: `flightdeckd changes get|sessions|watch`, the read side of a target's changes from a
 * terminal. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";

/** A review target (`session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`), or a file's absolute path. */
export type ChangesCliArgs =
  | { action: "get" | "watch"; target: string; json?: boolean }
  | { action: "sessions"; path: string; json?: boolean };

export async function runChangesCli(
  _args: ChangesCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: {
    timeoutMs?: number;
    remote?: RemoteTarget;
    signal?: AbortSignal;
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return { code: 1, out: [], err: [] };
}
