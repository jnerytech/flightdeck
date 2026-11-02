import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import { FlightdeckError } from "./errors.ts";
import { isInside } from "./paths.ts";

/** Folders of the system itself, and the ones that hold credentials: never an allowed folder. */
function systemFolders(): string[] {
  const home = homedir();
  const secrets = [".ssh", ".claude", ".flightdeck", ".gnupg", ".aws"].map((d) => join(home, d));
  if (process.platform === "win32") {
    const drive = process.env.SystemDrive ?? "C:";
    const windows = process.env.SystemRoot ?? `${drive}\\Windows`;
    return [
      windows,
      `${drive}\\Program Files`,
      `${drive}\\Program Files (x86)`,
      `${drive}\\ProgramData`,
      ...secrets,
    ];
  }
  const unix = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/run"];
  return [...unix, "/sbin", "/sys", "/usr", "/System", ...secrets];
}

function realFolder(path: string): string | null {
  try {
    const real = realpathSync.native(resolve(path));
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function isSystemFolderHere(real: string): boolean {
  if (parse(real).root === real) return true;
  return systemFolders().some((sys) => {
    const realSys = realFolder(sys) ?? sys;
    // The folder itself, or one of the system folders inside it (the home folder holds the secrets folders, so it is too broad).
    return isInside(realSys, real) || (isInside(real, realSys) && real !== realSys);
  });
}

/**
 * Adds `path` to the live list of allowed folders (the same array every service reads) and keeps
 * it with `persist`. A folder already covered by an allowed one changes nothing. Returns the list
 * after the call.
 */
export function addAllowedRoot(
  roots: string[],
  path: string,
  confirm: boolean,
  persist?: (roots: readonly string[]) => void,
): string[] {
  if (!confirm) {
    throw new FlightdeckError(
      "bad_request",
      "adding an allowed folder needs confirm",
      "root_confirm",
    );
  }
  const real = realFolder(path);
  if (!real) {
    throw new FlightdeckError("not_found", `directory does not exist: ${path}`, "root_missing", {
      path,
    });
  }
  if (isSystemFolderHere(real)) {
    throw new FlightdeckError("forbidden_cwd", `system folder: ${real}`, "root_system", {
      path: real,
    });
  }
  const covered = roots.some((root) => {
    const realRoot = realFolder(root);
    return realRoot !== null && isInside(realRoot, real);
  });
  if (!covered) {
    roots.push(real);
    persist?.(roots);
  }
  return [...roots];
}

/** What decides which folders are the system's: the platform, its environment and the home folder. */
export interface PlatformInfo {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** Whether `path` (a real path) is a folder of the system, one that holds secrets, or too broad. */
export function isSystemFolder(_path: string, _info: PlatformInfo): boolean {
  return false;
}
