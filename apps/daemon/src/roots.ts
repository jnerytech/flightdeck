import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { FlightdeckError } from "./errors.ts";
import { isInside } from "./paths.ts";

async function realFolder(path: string): Promise<string | null> {
  try {
    const real = await realpath(resolve(path));
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** What decides which folders are the system's: the platform, its environment and the home folder. */
export interface PlatformInfo {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** Folders of the system itself, and the ones that hold secrets or the user's whole application data. */
function systemFolders(info: PlatformInfo): string[] {
  const p = info.platform === "win32" ? win32 : posix;
  const secrets = [".ssh", ".claude", ".flightdeck", ".gnupg", ".aws"].map((d) =>
    p.join(info.home, d),
  );
  if (info.platform === "win32") {
    const drive = info.env.SystemDrive ?? "C:";
    const appData = [info.env.APPDATA, info.env.LOCALAPPDATA]
      .filter((dir): dir is string => Boolean(dir))
      .map((dir) => p.dirname(dir));
    return [
      info.env.SystemRoot ?? String.raw`${drive}\Windows`,
      String.raw`${drive}\Program Files`,
      String.raw`${drive}\Program Files (x86)`,
      String.raw`${drive}\ProgramData`,
      p.join(info.home, "AppData"),
      ...appData,
      ...secrets,
    ];
  }
  const unix = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/run"];
  return [...unix, "/sbin", "/sys", "/usr", "/System", ...secrets];
}

/**
 * Whether `path` (a real path) is a folder of the system, one that holds secrets, or too broad: a
 * drive or file system root, the home folder (it holds the secrets folders), or inside any of them.
 * Windows paths compare without case and with either slash.
 */
export async function isSystemFolder(
  path: string,
  info: PlatformInfo,
  real: (dir: string) => string | Promise<string> = (dir) => dir,
): Promise<boolean> {
  const win = info.platform === "win32";
  const p = win ? win32 : posix;
  const norm = (dir: string) => (win ? p.resolve(dir).toLowerCase() : p.resolve(dir));
  const inside = (root: string, child: string) => {
    const rel = p.relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
  };
  const target = norm(path);
  if (p.parse(target).root === target) return true;
  const systems = await Promise.all(systemFolders(info).map(async (sys) => norm(await real(sys))));
  // The folder itself, or one inside it; or a folder that holds a system one (the home folder).
  return systems.some(
    (system) => inside(system, target) || (inside(target, system) && target !== system),
  );
}

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
  platform: PlatformInfo = { platform: process.platform, env: process.env, home: homedir() },
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
