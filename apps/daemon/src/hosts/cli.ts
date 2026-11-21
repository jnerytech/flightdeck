/**
 * Issue #3424: `flightdeckd host [--json]`, what the local daemon reports about its host (the
 * version, the system, the features) from a terminal or a script. It asks `host.info` like the app
 * does, with the token of the config. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  DaemonRefusal,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import {
  BYPASS_NEEDS_APP,
  bypassLine,
  keepAwakeLine,
  pauseLine,
  sleepLine,
  UNSURE_HOST,
  updatesLine,
} from "./domain/host-write-view.ts";

export interface HostCliArgs {
  /** `--json`: one small object, for a script. */
  json?: boolean;
  /** A verb that changes one setting of the host (#3699); none reads the facts. */
  action?: "sleep" | "keep-awake" | "pause" | "updates" | "bypass";
  minutes?: number;
  on?: boolean;
  confirm?: boolean;
}

export interface HostCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
  /** A paired host to ask instead of this machine's daemon (`--host`, #3429); the config is not used then. */
  remote?: RemoteTarget;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** What the host says about bypass permissions: `unknown` for an older daemon that does not say. */
function bypassText(allowed: boolean | null): string {
  if (allowed === null) return "unknown";
  return allowed ? "allowed" : "not allowed";
}

/** One setting of the host, written: the daemon's answer is what the host keeps now. */
async function change(args: HostCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const on = args.on === true;
  switch (args.action) {
    case "sleep": {
      const { sleepAfterMinutes } = await daemon.call("host.sleep", { minutes: args.minutes ?? 0 });
      return shown(args.json, { sleepAfterMinutes }, () => [sleepLine(sleepAfterMinutes)]);
    }
    case "keep-awake": {
      const status = await daemon.call("host.keepAwake", { enabled: on });
      return shown(args.json, status, () => [keepAwakeLine(status)]);
    }
    case "pause": {
      const status = await daemon.call("host.pause", { paused: on });
      return shown(args.json, status, () => [pauseLine(status)]);
    }
    case "updates": {
      const status = await daemon.call("host.updates.set", { auto: on });
      return shown(args.json, status, () => [updatesLine(status)]);
    }
    default:
      return bypass(args, daemon);
  }
}

/** Turning bypass on needs the person's own word, and with a device enrolled its signature, which only the app has. */
async function bypass(args: HostCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const allow = args.on === true;
  try {
    const result = await daemon.call(
      "host.bypass",
      allow && args.confirm ? { allow, confirm: true } : { allow },
    );
    return shown(args.json, result, () => [bypassLine(result.allowBypassPermissions)]);
  } catch (error) {
    if (error instanceof DaemonRefusal && error.reason === "approval_proof_required")
      return failure(1, BYPASS_NEEDS_APP);
    throw error;
  }
}

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
    ...(args.action ? { unsure: UNSURE_HOST } : {}),
    perform: async (daemon, note) => {
      if (args.action) {
        note.wrote = true;
        return change(args, daemon);
      }
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
      const bypass = bypassText(facts.allowBypassPermissions);
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
