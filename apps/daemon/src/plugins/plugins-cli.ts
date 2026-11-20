/**
 * Issue #3516: `flightdeckd plugins list|detail|preview|preview-update`, the Claude Code plugins of a
 * host from a terminal or a script. It speaks to the daemon like `flightdeckd send` does (the same
 * `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * installs nothing: what an install would bring, with the hash a later install repeats. `preview-update`
 * first refreshes the marketplace's listing (the daemon runs `claude plugin marketplace update`, as the app's
 * update dialog does), so it reaches the network.
 */

import { resolve } from "node:path";
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  detailLines,
  listLines,
  type PluginsCliArgs,
  previewLines,
  updateLines,
} from "./domain/plugins-cli-view.ts";

/** A folder's preview runs the plugin manager's validation, which takes longer than a read. */
const DEFAULT_TIMEOUT_MS = 60_000;

export function runPluginsCli(
  args: PluginsCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-plugins",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: "",
    perform: async (daemon) => {
      if (args.action === "list") {
        const answer = await daemon.call("plugins.list", {});
        return args.json ? json(answer) : said(...listLines(answer));
      }
      if (args.action === "detail") {
        const answer = await daemon.call("plugins.detail", { plugin: args.plugin });
        return args.json ? json(answer) : said(...detailLines(answer));
      }
      if (args.action === "preview-update") {
        const answer = await daemon.call("plugins.previewUpdate", { plugin: args.plugin });
        return args.json ? json(answer) : said(...updateLines(answer));
      }
      if (args.action !== "preview") return said();
      // A relative folder means the shell's, so it is made absolute here; the daemon's own folder is another one.
      const where =
        "dir" in args
          ? { dir: options.remote ? args.dir : resolve(args.dir) }
          : { plugin: args.plugin };
      const answer = await daemon.call("plugins.preview", where);
      return args.json ? json(answer) : said(...previewLines(answer));
    },
  });
}
