import { stat } from "node:fs/promises";
import { type Config, claudeSettingsPath, updateConfigFile, userHome } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { stableBinPath } from "../service/index.ts";
import { claudeSettingsEnv } from "./claude-settings-env.ts";
import { terminalEnabled } from "./policy.ts";
import { bunPty, type PtyFactory } from "./pty.ts";
import { TerminalManager, type TerminalManagerOptions } from "./terminal-manager.ts";

/** What the terminals are built from: the daemon's config and what startDaemon was given. */
export interface TerminalsDeps {
  config: Pick<Config, "bind" | "terminal" | "allowedRoots" | "allowApiKey">;
  configFile: string;
  folderLocks: TerminalManagerOptions["folderLocks"];
  /** The PTY terminals run in; Bun's own when absent (tests inject a fake). */
  pty?: PtyFactory;
  /** This daemon's own command line: "Claude aqui" runs it, with this config. */
  self: string[];
  /** The environment `terminalInfo` reads (the home folder, the WSL distro). */
  env: Record<string, string | undefined>;
  log: (message: string) => void;
}

/**
 * The host's embedded terminals (issue #1593): the manager, and its module (#2094) that serves it
 * with the app's switch for them, kept in the config file like the rest of the host settings, and
 * stops every terminal.
 */
export async function createTerminals({
  config,
  configFile,
  folderLocks,
  pty,
  self,
  env,
  log,
}: TerminalsDeps) {
  const terminals = new TerminalManager({
    folderLocks,
    pty: pty ?? bunPty(),
    enabled: terminalEnabled(config.bind, config.terminal.enabled),
    allowedRoots: config.allowedRoots,
    max: config.terminal.max,
    idleMinutes: config.terminal.idleMinutes,
    allowApiKey: config.allowApiKey,
    // "Claude aqui" runs this very daemon's `claude`, with this config.
    claude: { self, configFile },
    claudeEnv: () => claudeSettingsEnv(claudeSettingsPath()),
    log,
  });
  const module: DomainModule<"terminals" | "onTerminalSettings" | "terminal"> = {
    server: {
      terminals,
      // Turned on or off from the app: kept in the config file, like the rest of the host settings.
      onTerminalSettings: (enabled: boolean) =>
        updateConfigFile(configFile, (raw) => ({
          ...raw,
          terminal: { ...(raw.terminal as object | undefined), enabled },
        })),
      // What "Abrir no terminal" needs from `host.info`.
      terminal: await terminalInfo(env),
    },
    // None outlives the daemon.
    stop: () => terminals.stop(),
  };
  return { modules: [module] as const, terminals };
}

/** What "Abrir no terminal" needs (phase 8): the stable binary when installed, the WSL distro. */
async function terminalInfo(env: Record<string, string | undefined>) {
  const stable = stableBinPath(userHome(env), process.platform);
  return {
    flightdeckdPath: (await stat(stable).then(
      () => true,
      () => false,
    ))
      ? stable
      : null,
    wslDistro: env.WSL_DISTRO_NAME || null,
  };
}
