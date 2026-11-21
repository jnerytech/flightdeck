/**
 * Issue #3755: `flightdeckd telemetry session|summary`, the timing of a terminal session from Claude Code's
 * OTLP export. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { sessionLines, summaryLines } from "./domain/telemetry-cli-view.ts";

export interface TelemetryCliArgs {
  action: "session" | "summary";
  /** `session`: the Claude session id. */
  id?: string;
  json?: boolean;
}

export async function runTelemetryCli(
  args: TelemetryCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-telemetry",
    timeoutMs: options.timeoutMs ?? 15_000,
    perform: async (daemon) =>
      args.action === "session"
        ? shown(
            args.json,
            await daemon.call("telemetry.session", { claudeSessionId: args.id ?? "" }),
            sessionLines,
          )
        : shown(args.json, await daemon.call("telemetry.summary", {}), summaryLines),
  });
}
