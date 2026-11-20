/**
 * Issue #3516: `flightdeckd plugins list|detail|preview|preview-update`, the Claude Code plugins of a
 * host from a terminal or a script. It speaks to the daemon like `flightdeckd send` does (the same
 * `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * installs nothing: what an install would bring, with the hash a later install repeats. `preview-update`
 * first refreshes the marketplace's listing (the daemon runs `claude plugin marketplace update`, as the app's
 * update dialog does), so it reaches the network.
 */

import { resolve } from "node:path";
import type { PluginChange } from "@flightdeck/protocol";
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  changeLines,
  detailLines,
  listLines,
  type PluginsCliArgs,
  plainChange,
  previewLines,
  updateLines,
} from "./domain/plugins-cli-view.ts";

/** A change the daemon made or refused: the message and the exit code its outcome says; `--json` prints the daemon's answer whole. */
function written(change0: PluginChange, asJson: boolean | undefined): CliResult {
  const change = plainChange(change0);
  const { code, lines } = changeLines(change);
  if (code === 0) return asJson ? json(change) : said(...lines);
  const shown = asJson ? json(change) : { out: [], err: said(...lines).out };
  return { ...shown, code, reason: change.outcome };
}

/** What a write that got no answer may have done: the daemon installs and removes code, so the person checks before repeating it. */
const UNSURE =
  "; the change may or may not have happened: run flightdeckd plugins list before repeating it";

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
    unsure: UNSURE,
    perform: async (daemon, note) => {
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
      // A relative folder means the shell's, so it is made absolute here; the daemon's own folder is another one.
      const folder = (dir: string) => ({ dir: options.remote ? dir : resolve(dir) });
      if (args.action === "preview") {
        const where = "dir" in args ? folder(args.dir) : { plugin: args.plugin };
        const answer = await daemon.call("plugins.preview", where);
        return args.json ? json(answer) : said(...previewLines(answer));
      }
      note.wrote = true;
      if (args.action === "install") {
        const { confirmHash, scope, acceptCommand } = args;
        const what = "dir" in args ? folder(args.dir) : { plugin: args.plugin };
        return written(
          await daemon.call("plugins.install", {
            ...what,
            confirmHash,
            ...(scope === undefined ? {} : { scope }),
            ...(acceptCommand === undefined ? {} : { acceptCommand }),
          }),
          args.json,
        );
      }
      if (args.action === "update") {
        const { plugin, confirmHash, acceptCommand } = args;
        return written(
          await daemon.call("plugins.update", {
            plugin,
            confirmHash,
            ...(acceptCommand === undefined ? {} : { acceptCommand }),
          }),
          args.json,
        );
      }
      if (args.action === "uninstall") {
        const { plugin, scope, confirm } = args;
        return written(
          await daemon.call("plugins.uninstall", {
            plugin,
            ...(scope === undefined ? {} : { scope }),
            ...(confirm ? { confirm } : {}),
          }),
          args.json,
        );
      }
      if (args.action === "pin" || args.action === "unpin") {
        const answer = await daemon.call("plugins.pin", {
          plugin: args.plugin,
          pinned: args.action === "pin",
        });
        return args.json ? json(answer) : said(...detailLines(answer));
      }
      if (args.action === "marketplace-add") {
        const { source, scope, confirm } = args;
        return written(
          await daemon.call("plugins.marketplaceAdd", {
            source,
            ...(scope === undefined ? {} : { scope }),
            ...(confirm ? { confirm } : {}),
          }),
          args.json,
        );
      }
      if (args.action === "marketplace-remove") {
        const { name, confirm } = args;
        return written(
          await daemon.call("plugins.marketplaceRemove", { name, ...(confirm ? { confirm } : {}) }),
          args.json,
        );
      }
      return written(
        await daemon.call(
          "plugins.marketplaceUpdate",
          args.name === undefined ? {} : { name: args.name },
        ),
        args.json,
      );
    },
  });
}
