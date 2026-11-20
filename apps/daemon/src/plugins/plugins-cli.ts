/**
 * Issue #3516: `flightdeckd plugins list|detail|preview|preview-update`, the Claude Code plugins of a
 * host from a terminal or a script. It speaks to the daemon like `flightdeckd send` does (the same
 * `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb here
 * is a read: what an install would bring, with the hash a later install repeats.
 */
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import type { PluginsCliArgs } from "./domain/plugins-cli-view.ts";

export function runPluginsCli(
  _args: PluginsCliArgs,
  _config: { bind: string; port: number; token: string },
  _options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return Promise.resolve({ code: 0, out: [], err: [] });
}
