/**
 * Issue #3703: `flightdeckd account get|refresh|watch`, the Claude account of a host from a terminal (stub: red tests first).
 */
import type { CliResult, StreamOptions } from "../daemon-client/index.ts";

export interface AccountCliArgs {
  action: "get" | "refresh" | "watch";
  json?: boolean;
}

export async function runAccountCli(
  _args: AccountCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: StreamOptions & { timeoutMs?: number } = {},
): Promise<CliResult> {
  return { code: 1, out: [], err: ["not built yet"] };
}
