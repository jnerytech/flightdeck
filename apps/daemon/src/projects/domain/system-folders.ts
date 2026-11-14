/**
 * The system folders of the projects domain (#1601): which folders a host never allows as a root,
 * per platform. Pure: the platform, its environment and the real-path lookup come in as arguments.
 */
import { posix, win32 } from "node:path";

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
