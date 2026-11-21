/**
 * Issue #3780: `flightdeckd update check|apply`, the daemon's own update from a shell. `check` reads what the
 * release server has; `apply --confirm` has the daemon install it and restart, and the answer is only that it
 * started (the daemon is gone for a moment after it). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { type CliResult, runOnLocalDaemon, shown } from "../daemon-client/index.ts";
import {
  UNSURE_APPLY,
  UPDATE_STARTED,
  updateCheckJson,
  updateCheckLine,
} from "./domain/update-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface UpdateCliArgs {
  action: "check" | "apply";
  json?: boolean;
}

export async function runUpdateCli(
  args: UpdateCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-update",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "apply" ? { unsure: UNSURE_APPLY } : {}),
    perform: async (daemon, note) => {
      if (args.action === "apply") {
        note.wrote = true;
        const started = await daemon.call("daemon.update.apply", { confirm: true });
        return shown(args.json, started, () => [UPDATE_STARTED]);
      }
      const status = await daemon.call("daemon.update.check", {});
      return shown(args.json, updateCheckJson(status), () => [updateCheckLine(status)]);
    },
  });
}
