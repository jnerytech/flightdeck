import type { Logger } from "../logger.ts";
import { FileLog } from "./file-log.ts";
import { createLogScanner } from "./scanner.ts";

/** What the daemon's log is built from. */
export interface HostLogDeps {
  /** Where every line also goes as it is said. */
  console: Logger;
  /** The folder of the rotated log files. */
  dir: string;
  /** The user's home folder, written as `~`. */
  home: string;
  /** The tokens the config holds: the protocol's at startup and the hooks'. */
  config: { token: string; hooks: { token?: string } };
  /** The protocol's token as it is now: it rotates after startup. */
  currentToken: () => string;
  /** What the vault holds now: nothing until the vault exists. */
  heldValues: () => string[];
}

/**
 * The daemon's log (#255, #1593): each line to the console and, redacted, to a rotated file.
 * Never written: the daemon's tokens (the config's, the rotated one, the hooks') and what the
 * vault holds, read at each line.
 */
export function createHostLog(deps: HostLogDeps): { logger: Logger; fileLog: FileLog } {
  const { config } = deps;
  const fileLog = new FileLog({
    dir: deps.dir,
    home: deps.home,
    scanner: createLogScanner({
      tokens: () => [config.token, deps.currentToken(), config.hooks.token ?? ""].filter(Boolean),
      vaultValues: deps.heldValues,
    }),
  });
  const logger: Logger = {
    log: (message) => {
      deps.console.log(message);
      fileLog.write("info", message);
    },
    error: (message) => {
      deps.console.error(message);
      fileLog.write("error", message);
    },
  };
  return { logger, fileLog };
}
