import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { DepsResult, DoctorResult } from "@flightdeck/protocol";
import { hooksStatus, hookTarget } from "../central/index.ts";
import { type Config, claudeSettingsPath } from "../config.ts";
import { runDoctor } from "../doctor.ts";
import { spawnExec } from "../exec.ts";
import { lingerState } from "../linger.ts";
import { mcpReachable } from "../mcp.ts";
import { tailscaleIp } from "../pairing.ts";
import { openCodeState } from "../runtime/index.ts";
import { daemonCommand, type ServiceContext, serviceCommand } from "../service.ts";
import { osServiceContext } from "../service-os.ts";
import { BUILTIN_TEMPLATES, loadTemplates } from "../templates/index.ts";
import { DAEMON_VERSION } from "../version.ts";
import { whichOnPath } from "../which.ts";
import { checkDeps, type DepsEnv } from "./deps.ts";
import { probeVersion } from "./probe.ts";

/** What the host's checks read: the daemon's config and what it found at start. */
export interface HostChecksDeps {
  config: Config;
  env: Record<string, string | undefined>;
  /** What discovery found of OpenCode when the daemon started. */
  opencode: { info: Parameters<typeof openCodeState>[2] };
  /** The runtime's `claude`, when the real runtime has one. */
  claude?: { path: string | null };
  /** The `claude` `flightdeckd setup` wrote into the config, if any. */
  claudePath: string | undefined;
  /** Who the host's own `claude` is signed in as, as the account card reads it. */
  account: DepsEnv["account"];
  /** The service and linger probes; tests give theirs, the real ones ask the OS. */
  options: HostCheckOptions;
}

/** The probes of the host's checks that `startDaemon`'s options may replace (tests give theirs). */
export interface HostCheckOptions {
  /** Whether the OS service is installed, for `doctor.run`; the real service manager when absent. */
  serviceInstalled?: () => Promise<boolean>;
  /** Whether linger is on, for `doctor.run`; `loginctl` when absent. */
  linger?: () => Promise<"on" | "off" | null>;
  /** The machine's service manager, for the probes above when they are not given; the real one when absent. */
  serviceContext?: (dryRun: boolean) => ServiceContext;
}

/**
 * The host's checks as the app asks for them (issue #1593): the doctor's rows and the
 * Dependencies section, over the same probes as `flightdeckd doctor`.
 */
export function createHostChecks({
  config,
  env,
  opencode,
  claude,
  claudePath,
  account,
  options,
}: HostChecksDeps): {
  doctor: (appVersion?: string) => Promise<DoctorResult>;
  deps: () => Promise<DepsResult>;
} {
  // What both read: this executable, the service, linger and the hooks it would install.
  const self = daemonCommand(process.execPath, Bun.main);
  const serviceContext = () => (options.serviceContext ?? osServiceContext)(false);
  const serviceInstalled =
    options.serviceInstalled ?? (async () => (await serviceCommand(serviceContext())) !== null);
  const linger = options.linger ?? (() => lingerState(serviceContext()));
  const hooks = () => hooksStatus(claudeSettingsPath(), hookTarget(config, self));
  return {
    // The daemon answers for itself: the live roots (`roots.add` pushes into this array), the
    // folders checked without blocking, and the app's version to compare with its own.
    doctor: (appVersion) =>
      runDoctor({
        config: () => ({ bind: config.bind, port: config.port, allowedRoots: config.allowedRoots }),
        isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
        serviceInstalled,
        healthy: () => Promise.resolve(true),
        mcp: () => mcpReachable(self),
        opencode: () => openCodeState(config, env, opencode.info),

        linger,
        tailscaleIp: () => tailscaleIp(spawnExec),
        hooks,
        claudePath: () => claude?.path ?? whichOnPath("claude"),
        templateProblems: async () =>
          (
            await loadTemplates({
              dir: join(config.dataDir, "templates"),
              builtins: BUILTIN_TEMPLATES,
            })
          ).problems,
        version: { daemon: DAEMON_VERSION, ...(appVersion ? { app: appVersion } : {}) },
      }),
    // The dependencies of this host: the same probes as the doctor, the program on the PATH and its version.
    deps: () =>
      checkDeps({
        platform: process.platform,
        // Like host.info: the path `flightdeckd setup` wrote, since a service's PATH does not see claude.
        which: async (name) => {
          const configured = name === "claude" ? claudePath : undefined;
          if (!configured) return whichOnPath(name);
          return (await Bun.file(configured).exists()) ? configured : null;
        },
        version: (path) => probeVersion([path, "--version"]),
        allowedRoots: config.allowedRoots,
        serviceInstalled,
        linger,
        account,
        hooks,
      }),
  };
}
