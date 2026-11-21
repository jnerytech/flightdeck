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
  type DaemonClient,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  shown,
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
  const printed = asJson ? json(change) : { out: [], err: said(...lines).out };
  return { ...printed, code, reason: change.outcome };
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
      switch (args.action) {
        case "list":
          return shown(args.json, await daemon.call("plugins.list", {}), listLines);
        case "detail":
          return shown(
            args.json,
            await daemon.call("plugins.detail", { plugin: args.plugin }),
            detailLines,
          );
        case "preview-update":
          return shown(
            args.json,
            await daemon.call("plugins.previewUpdate", { plugin: args.plugin }),
            updateLines,
          );
        case "preview":
          return shown(
            args.json,
            await daemon.call("plugins.preview", targetOf(args, options.remote)),
            previewLines,
          );
        default:
          note.wrote = true;
          return writeVerb(args, daemon, options.remote);
      }
    },
  });
}

/** A relative folder means the shell's, so it is made absolute here; the daemon's own folder is another one. */
function targetOf(
  args: Extract<PluginsCliArgs, { action: "preview" | "install" }>,
  remote: RemoteTarget | undefined,
) {
  return "dir" in args ? { dir: remote ? args.dir : resolve(args.dir) } : { plugin: args.plugin };
}

const scoped = <T>(scope: T | undefined) => (scope === undefined ? {} : { scope });
const confirmed = (confirm: boolean | undefined) => (confirm ? { confirm } : {});
const accepted = (acceptCommand: string | undefined) =>
  acceptCommand === undefined ? {} : { acceptCommand };

/** The verbs that change the host's plugins: the daemon installs, updates and removes code. */
async function writeVerb(
  args: Exclude<PluginsCliArgs, { action: "list" | "detail" | "preview-update" | "preview" }>,
  daemon: DaemonClient,
  remote: RemoteTarget | undefined,
): Promise<CliResult> {
  switch (args.action) {
    case "install":
      return written(
        await daemon.call("plugins.install", {
          ...targetOf(args, remote),
          confirmHash: args.confirmHash,
          ...scoped(args.scope),
          ...accepted(args.acceptCommand),
        }),
        args.json,
      );
    case "update":
      return written(
        await daemon.call("plugins.update", {
          plugin: args.plugin,
          confirmHash: args.confirmHash,
          ...accepted(args.acceptCommand),
        }),
        args.json,
      );
    case "uninstall":
      return written(
        await daemon.call("plugins.uninstall", {
          plugin: args.plugin,
          ...scoped(args.scope),
          ...confirmed(args.confirm),
        }),
        args.json,
      );
    case "pin":
    case "unpin":
      return shown(
        args.json,
        await daemon.call("plugins.pin", { plugin: args.plugin, pinned: args.action === "pin" }),
        detailLines,
      );
    case "marketplace-add":
      return written(
        await daemon.call("plugins.marketplaceAdd", {
          source: args.source,
          ...scoped(args.scope),
          ...confirmed(args.confirm),
        }),
        args.json,
      );
    case "marketplace-remove":
      return written(
        await daemon.call("plugins.marketplaceRemove", {
          name: args.name,
          ...confirmed(args.confirm),
        }),
        args.json,
      );
    case "marketplace-update":
      return written(
        await daemon.call(
          "plugins.marketplaceUpdate",
          args.name === undefined ? {} : { name: args.name },
        ),
        args.json,
      );
  }
}
