import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { type Config, userHome } from "../config.ts";
import { FlightdeckError, isInside, type Logger } from "../kernel/index.ts";
import { isSystemFolder, type PlatformInfo } from "./domain/system-folders.ts";

async function realFolder(path: string): Promise<string | null> {
  try {
    const real = await realpath(resolve(path));
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** This machine's platform, environment and home folder. */
const currentPlatform = (): PlatformInfo => ({
  platform: process.platform,
  env: process.env,
  home: userHome(),
});

/**
 * Adds `path` to the live list of allowed folders (the same array every service reads) and keeps
 * it with `persist`. A folder already covered by an allowed one changes nothing. Returns the list
 * after the call. `platform` is what decides the system folders (the process's own by default; a
 * test gives its own, since a CI runner keeps its temp folders inside the user's AppData).
 */
export async function addAllowedRoot(
  roots: string[],
  path: string,
  confirm: boolean,
  persist?: (roots: readonly string[]) => void | Promise<void>,
  platform: PlatformInfo = currentPlatform(),
): Promise<string[]> {
  if (!confirm) {
    throw new FlightdeckError(
      "bad_request",
      "adding an allowed folder needs confirm",
      "root_confirm",
    );
  }
  const real = await realFolder(path);
  if (!real) {
    throw new FlightdeckError("not_found", `directory does not exist: ${path}`, "root_missing", {
      path,
    });
  }
  if (await isSystemFolder(real, platform, async (dir) => (await realFolder(dir)) ?? dir)) {
    throw new FlightdeckError("forbidden_cwd", `system folder: ${real}`, "root_system", {
      path: real,
    });
  }
  const realRoots = await Promise.all(roots.map(realFolder));
  const covered = realRoots.some((realRoot) => realRoot !== null && isInside(realRoot, real));
  if (!covered) {
    roots.push(real);
    await persist?.(roots);
  }
  return [...roots];
}

/** Without an allowed root no session can be created: the log says so at the start. */
export function warnIfNoRoots(config: Config, logger: Logger): void {
  if (config.allowedRoots.length > 0) return;
  logger.error(
    'warning: allowedRoots is empty; no session can be created (run "flightdeckd setup")',
  );
}
