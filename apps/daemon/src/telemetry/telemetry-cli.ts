/**
 * Issue #3755: `flightdeckd telemetry session|summary`, the timing of a terminal session from Claude Code's
 * OTLP export. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";

export interface TelemetryCliArgs {
  action: "session" | "summary";
  /** `session`: the Claude session id. */
  id?: string;
  json?: boolean;
}

export async function runTelemetryCli(
  _args: TelemetryCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return { code: 0, out: [], err: [] };
}
