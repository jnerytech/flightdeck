/**
 * Issue #3424: `flightdeckd host [--json]`, what the local daemon reports about its host (the
 * version, the system, the features) from a terminal or a script. It asks `host.info` like the app
 * does, with the token of the config. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

export interface HostCliArgs {
  /** `--json`: one small object, for a script. */
  json?: boolean;
}

export interface HostCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
  /** A paired host to ask instead of this machine's daemon (`--host`, #3429); the config is not used then. */
  remote?: RemoteTarget;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export function runHostCli(
  args: HostCliArgs,
  config: { bind: string; port: number; token: string },
  options: HostCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-host",
    ...(options.remote ? { remote: options.remote } : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const info = await daemon.call("host.info", {});
      // A small, stable shape on purpose: the paths and the settings of the host are not for a script.
      // What an older daemon does not say is null (or no features), never a missing key.
      const facts = {
        hostName: info.hostName,
        os: info.os,
        arch: info.arch,
        daemonVersion: info.daemonVersion,
        claudeVersion: info.claudeVersion,
        activeSessions: info.activeSessions,
        features: info.features ?? [],
        allowBypassPermissions: info.allowBypassPermissions ?? null,
      };
      if (args.json) return json(facts);
      const bypass =
        facts.allowBypassPermissions === null
          ? "unknown"
          : facts.allowBypassPermissions
            ? "allowed"
            : "not allowed";
      return said(
        `host  ${facts.hostName}`,
        `daemon  ${facts.daemonVersion}`,
        `system  ${facts.os} ${facts.arch}`,
        `claude  ${facts.claudeVersion ?? "not found"}`,
        `sessions  ${facts.activeSessions} active`,
        `features  ${facts.features.join(", ") || "none"}`,
        `bypass permissions  ${bypass}`,
      );
    },
  });
}
