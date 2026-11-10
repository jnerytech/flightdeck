import { type Config, claudeSettingsPath, updateConfigFile } from "../config.ts";
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
  log: (message: string) => void;
}

/**
 * The host's embedded terminals (issue #1593): the manager and the app's switch for them, kept in
 * the config file like the rest of the host settings.
 */
export function createTerminals({
  config,
  configFile,
  folderLocks,
  pty,
  self,
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
  return {
    terminals,
    // Turned on or off from the app: kept in the config file, like the rest of the host settings.
    onTerminalSettings: (enabled: boolean) =>
      updateConfigFile(configFile, (raw) => ({
        ...raw,
        terminal: { ...(raw.terminal as object | undefined), enabled },
      })),
  };
}
