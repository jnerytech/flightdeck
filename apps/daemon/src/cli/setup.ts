/**
 * The commands that set a host up and check it (issue #1593): `flightdeckd setup` (the guided first
 * run), `flightdeckd doctor` (what a first run needs) and `flightdeckd pair` (the pairing link).
 */
import { stat } from "node:fs/promises";
import { formatPairingLink } from "@flightdeck/protocol";
import { type Config, loadConfig } from "../config.ts";
import { createHostChecks, type DepsEnv, doctorExitCode, formatDeps } from "../deps/index.ts";
import { DAEMON_VERSION, type Exec, linesOf, spawnExec } from "../kernel/index.ts";
import {
  loopbackOnly,
  pairingAddress,
  renderQr,
  rotateToken,
  tailscaleIp,
} from "../pairing/index.ts";
import {
  addToUserPath,
  binaryVersion,
  binDir,
  createPrompt,
  daemonCommand,
  installStableBinary,
  lingerState,
  osServiceContext,
  reconcileStableBinary,
  refusedAddress,
  runSetup,
  serviceCommand,
  stableBinPath,
  waitHealthy,
} from "../service/index.ts";
import { detectWsl, readProcVersion } from "../wsl/index.ts";
import { type CliArgs, configPath } from "./args.ts";
import { type ClaudeSettingsCommandDeps, runHooks } from "./claude-settings.ts";
import { type HostCommandDeps, healthUrl, runService, stopInstalledDaemon } from "./host.ts";

/**
 * What the setup, doctor and pair commands need of the command line's deps (main.ts's `CliDeps`):
 * setup runs the service and hooks commands too, so it needs theirs.
 */
export interface SetupCommandDeps extends HostCommandDeps, ClaudeSettingsCommandDeps {
  env: Record<string, string | undefined>;
  /** The machine the dependency check probes, in `doctor`; the real one when absent (tests give theirs). */
  depsEnv?: DepsEnv;
  /** Runs external commands (`tailscale ip -4`); injected in tests. */
  exec?: Exec;
  /** What `<bin> --version` says; the real one runs the binary. Injected in tests. */
  binaryVersion?: (bin: string) => Promise<string | null>;
  /** Standard input (`hook session-start` reads the hook's JSON); the process's if absent. */
  stdin?: ReadableStream<Uint8Array>;
  /** Where `setup` writes its questions; the process's stdout if absent. */
  stdout?: (text: string) => void;
}

/** The text of a file, or null when it is not there. */
const readTextOrNull = (path: string) =>
  Bun.file(path)
    .text()
    .catch(() => null);

/** `flightdeckd pair`: prints the pairing link and its QR code. */
export async function runPair(args: CliArgs, deps: SetupCommandDeps): Promise<void> {
  const file = configPath(args);
  if (args.rotate) await rotateToken(file);
  const config = await loadConfig(file);
  const tailscale = await tailscaleIp(deps.exec ?? spawnExec);
  const address = pairingAddress(config.bind, tailscale);
  const link = formatPairingLink({
    address,
    port: config.port,
    name: config.hostName,
    token: config.token,
  });
  deps.log.log(link);
  deps.log.log(await renderQr(link));
  if (tailscale && loopbackOnly(config.bind)) {
    deps.log.error(
      `the daemon listens only on ${config.bind}: another machine cannot use the link above. To pair over Tailscale (${tailscale}), run "flightdeckd setup" and accept the Tailscale question.`,
    );
  }
}

/** `flightdeckd doctor`: what a first run needs, with the fix for each failure. Exit 1 on a failure. */
export async function runDoctorCommand(args: CliArgs, deps: SetupCommandDeps): Promise<number> {
  const file = configPath(args);
  let config: Config | null = null;
  const load = async () => {
    config ??= await loadConfig(file);
    return config;
  };
  // The same checks the running daemon answers the app with; only the daemon's own address is asked here.
  const { checks } = createHostChecks({
    config: load,
    env: deps.env,
    opencode: {},
    // The terminal does not ask the Claude account: the card in the app does.
    account: async () => null,
    options: { ...(deps.serviceContext ? { serviceContext: deps.serviceContext } : {}) },
    cli: {
      healthy: async (cfg) => waitHealthy(healthUrl(cfg), 1_000, 250),
      refused: async (cfg) => refusedAddress(healthUrl(cfg), 1_000),
      ...(deps.exec ? { exec: deps.exec } : {}),
      ...(deps.selfCommand ? { self: deps.selfCommand } : {}),
      ...(deps.depsEnv ? { depsEnv: deps.depsEnv } : {}),
    },
  });
  const report = await checks.doctor();
  for (const item of report.checks) {
    deps.log.log(`${item.status.toUpperCase().padEnd(4)} ${item.name.padEnd(16)} ${item.detail}`);
    if (item.fix) deps.log.log(`     -> ${item.fix}`);
  }
  // What the host needs and does without, grouped like the app's Dependencies section.
  const found = await checks.deps();
  for (const line of formatDeps(found, process.platform)) deps.log.log(line);
  return doctorExitCode(report.ok, found);
}

/** `flightdeckd setup`: the guided first run (folders, service started now, pair link). */
export async function runSetupCommand(args: CliArgs, deps: SetupCommandDeps): Promise<void> {
  const file = configPath(args);
  const ctxOf = deps.serviceContext ?? osServiceContext;
  const base = ctxOf(false);
  const stable = stableBinPath(base.home, base.platform);
  let command = base.command;
  const prompt = createPrompt(
    linesOf(deps.stdin ?? Bun.stdin.stream()),
    deps.stdout ?? process.stdout.write.bind(process.stdout),
  );
  const install = (): CliArgs => ({ command: "service", action: "install", config: file });
  await runSetup(
    {
      ...prompt,
      log: deps.log,
      configFile: file,
      home: base.home,
      wsl: detectWsl({ env: deps.env, procVersion: () => readProcVersion() }),
      // The folders it checks are this host's, whatever the service context says it manages.
      platform: process.platform,
      isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
      tailscaleIp: () => tailscaleIp(deps.exec ?? spawnExec),
      installBinary: async () => {
        const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
        const placed = await installStableBinary(self, stable, base.platform);
        if (placed === "source") return false;
        command = [stable];
        let running = DAEMON_VERSION;
        if (placed === "kept") {
          const probe = deps.binaryVersion ?? ((bin: string) => binaryVersion(bin, 10_000));
          const result = await reconcileStableBinary({
            self: self[0] as string,
            stable,
            selfVersion: DAEMON_VERSION,
            stableVersion: () => probe(stable),
            stopService: async () => {
              if ((await stopInstalledDaemon(install(), ctxOf(false), deps)) === false) {
                throw new Error(
                  `the daemon of the service still runs ${stable}: stop it and run setup again`,
                );
              }
            },
          });
          const was = result.stableVersion ?? "unknown version";
          if (result.outcome === "replaced") {
            deps.log.log(
              `replaced ${stable} (${was}) with ${DAEMON_VERSION}; the old one is at ${stable}.old`,
            );
          } else if (result.outcome === "same") {
            deps.log.log(`${stable} is already version ${DAEMON_VERSION} and stays`);
          } else {
            running = result.stableVersion as string;
            deps.log.log(
              `${stable} is version ${running}, newer than this download (${DAEMON_VERSION}), and stays`,
            );
          }
        } else if (placed === "copied") {
          deps.log.log(`flightdeckd ${DAEMON_VERSION} copied to ${stable}`);
        }
        deps.log.log(`The service will run ${stable} (flightdeckd ${running})`);
        return true;
      },
      addToPath: async () => {
        const env = { ...base, readFile: readTextOrNull };
        for (const line of await addToUserPath(env, binDir(base))) deps.log.log(line);
      },
      linger: () => lingerState(base),
      installService: async () => {
        const ctx = ctxOf(false);
        if ((await serviceCommand(ctx)) !== null) await stopInstalledDaemon(install(), ctx, deps);
        await runService(install(), {
          ...deps,
          serviceContext: (dryRun) => ({ ...ctxOf(dryRun), command }),
        });
      },
      installHooks: () => runHooks({ command: "hooks", action: "install", config: file }, deps),
      pair: () => runPair({ command: "pair", config: file }, deps),
    },
    { ...(args.yes ? { yes: true } : {}), ...(args.folders ? { folders: args.folders } : {}) },
  );
}
