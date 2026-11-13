import { stat } from "node:fs/promises";
import { join } from "node:path";
import { hooksStatus, hookTarget } from "../central/index.ts";
import { type Config, claudeSettingsPath } from "../config.ts";
import { DAEMON_VERSION, type Exec, spawnExec, whichOnPath } from "../kernel/index.ts";
import { mcpReachable } from "../mcp/index.ts";
import { tailscaleIp } from "../pairing/index.ts";
import { openCodeState } from "../runtime/index.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import {
  daemonCommand,
  lingerState,
  osServiceContext,
  type ServiceContext,
  serviceCommand,
} from "../service/index.ts";
import { BUILTIN_TEMPLATES, loadTemplates } from "../templates/index.ts";
import { probeVersion } from "./adapters/version-probe.ts";
import { checkDeps, type DepsEnv } from "./deps.ts";
import { runDoctor } from "./doctor.ts";

/** What the host's checks read: the daemon's config and what it found at start. */
export interface HostChecksDeps {
  /** The config, read when a check runs: the running daemon's live object, or the CLI's file. */
  config: () => Config | Promise<Config>;
  env: Record<string, string | undefined>;
  /** What discovery found of OpenCode when the daemon started; the CLI has none and asks. */
  opencode: { info?: Parameters<typeof openCodeState>[2] };
  /** The runtime's `claude`, when the real runtime has one. */
  claude?: { path: string | null };
  /** Who the host's own `claude` is signed in as, as the account card reads it. */
  account: DepsEnv["account"];
  /** The service and linger probes; tests give theirs, the real ones ask the OS. */
  options: HostCheckOptions;
  /** What only `flightdeckd doctor` has: it runs without the daemon, so it asks the daemon's address itself. */
  cli?: CliChecks;
}

/** The probes of `flightdeckd doctor` that a running daemon answers for itself. */
interface CliChecks {
  /** Whether a daemon answers on the config's address. */
  healthy: (config: Config) => Promise<boolean>;
  /** The address a daemon refused, when that is why nothing answers. */
  refused: (config: Config) => Promise<string | null>;
  /** Runs `tailscale ip -4`; the real one when absent. */
  exec?: Exec;
  /** This executable, for the MCP and the hooks checks; the real one when absent. */
  self?: string[];
  /** The dependency check's machine, when a test gives its own. */
  depsEnv?: DepsEnv;
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
  account,
  options,
  cli,
}: HostChecksDeps) {
  // What both read: this executable, the service, linger and the hooks it would install.
  const self = cli?.self ?? daemonCommand(process.execPath, Bun.main);
  const serviceContext = () => (options.serviceContext ?? osServiceContext)(false);
  const serviceInstalled =
    options.serviceInstalled ?? (async () => (await serviceCommand(serviceContext())) !== null);
  const linger = options.linger ?? (() => lingerState(serviceContext()));
  const hooks = async () => hooksStatus(claudeSettingsPath(), hookTarget(await config(), self));
  // Like host.info: the `claude` `flightdeckd setup` wrote into the config wins, since a service's PATH does not see it.
  const which = async (name: string) => {
    const cfg = await config();
    const configured =
      name === "claude" ? (cfg.claude?.executablePath ?? cfg.claudePath) : undefined;
    if (!configured) return whichOnPath(name);
    return (await Bun.file(configured).exists()) ? configured : null;
  };
  const checks = {
    // The daemon answers for itself: the live roots (`roots.add` pushes into this array), the
    // folders checked without blocking, and the app's version to compare with its own.
    doctor: (appVersion?: string) =>
      runDoctor({
        config: async () => {
          const { bind, port, allowedRoots } = await config();
          return { bind, port, allowedRoots };
        },
        isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
        serviceInstalled,
        healthy: async () => (cli ? cli.healthy(await config()) : true),
        ...(cli ? { refused: async () => cli.refused(await config()) } : {}),
        mcp: () => mcpReachable(self),
        opencode: async () => openCodeState(await config(), env, opencode.info),

        linger,
        tailscaleIp: () => tailscaleIp(cli?.exec ?? spawnExec),
        hooks,
        claudePath: async () => claude?.path ?? (await which("claude")),
        templateProblems: async () =>
          (
            await loadTemplates({
              dir: join((await config()).dataDir, "templates"),
              builtins: BUILTIN_TEMPLATES,
            })
          ).problems,
        // Only a running daemon has a version to compare with the app's.
        ...(cli
          ? {}
          : { version: { daemon: DAEMON_VERSION, ...(appVersion ? { app: appVersion } : {}) } }),
      }),
    // The dependencies of this host: the same probes as the doctor, the program on the PATH and its version.
    deps: async () =>
      checkDeps(
        cli?.depsEnv ?? {
          platform: process.platform,
          which,
          version: (path) => probeVersion([path, "--version"]),
          allowedRoots: (await config()).allowedRoots,
          serviceInstalled,
          linger,
          account,
          hooks,
        },
      ),
  };
  const hostChecks = serverGroup<"hostChecks">()(checks);
  const module: DomainModule<"hostChecks"> = { server: { hostChecks } };
  return { modules: [module] as const, checks };
}
