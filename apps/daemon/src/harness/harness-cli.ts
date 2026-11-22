/**
 * Issue #3738: `flightdeckd harness templates list|delete`, the host's harness templates from a shell. `delete`
 * sends `confirm: true` only because the person typed `--confirm`; the daemon refuses a far connection.
 * Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { deletedLine, harnessTemplateLines, UNSURE_DELETE } from "./domain/harness-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export type HarnessCliArgs = { json?: boolean } & (
  | { action: "list" }
  | { action: "delete"; id: string }
);

export async function runHarnessCli(
  args: HarnessCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-harness",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "delete" ? { unsure: UNSURE_DELETE } : {}),
    perform: async (daemon, note) => {
      if (args.action === "list") {
        const { templates } = await daemon.call("harness.templates.list", {});
        return shown(args.json, { templates }, () => harnessTemplateLines(templates));
      }
      note.wrote = true;
      const done = await daemon.call("harness.templates.delete", { id: args.id, confirm: true });
      return shown(args.json, done, () => [deletedLine(done.id)]);
    },
  });
}
