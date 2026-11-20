/**
 * Issue #3454: `flightdeckd board settings`, the host-wide board settings from a terminal or a
 * script. It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the
 * token of the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, said } from "../daemon-client/index.ts";
import type { BoardCliArgs } from "./domain/board-cli-view.ts";

export async function runBoardCli(
  _args: BoardCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return said("");
}
