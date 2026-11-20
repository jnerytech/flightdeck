/**
 * Issue #3425: `flightdeckd requests [--session <session>] [--json]`, the open permission requests of
 * the local daemon, oldest first. The daemon lists them in the summary of each session, so the command
 * asks for the summaries once (`sessions.watch` with the snapshot in the ack) and closes. Exit codes:
 * 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  resolveSession,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

import { requestLine, requestRows } from "./domain/requests-view.ts";

export interface RequestsCliArgs {
  /** `--session`: only the requests of this session (its id or its name). */
  session?: string;
  json?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function runRequestsCli(
  args: RequestsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-requests",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const summaries = (await daemon.call("sessions.watch", { snapshot: "ack" }))?.summaries ?? [];
      let only: string | undefined;
      if (args.session !== undefined) {
        const ref = resolveSession(
          summaries.map((s) => ({ id: s.sessionId, name: s.name })),
          args.session,
        );
        if ("refusal" in ref) return ref.refusal;
        only = ref.id;
      }
      const rows = requestRows(summaries, only);
      if (args.json) return json(rows);
      return said(...(rows.length > 0 ? rows.map(requestLine) : ["no pending requests"]));
    },
  });
}
