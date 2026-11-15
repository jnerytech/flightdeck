import { isCheckEnvName } from "@flightdeck/protocol";

/** The daemon's variables a bounded check keeps on POSIX (names are case-sensitive there). */
const POSIX_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);

/** The same on Windows, in upper case: Windows reads `Path` and `PATH` as one name. */
const WINDOWS_ENV = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
]);

/**
 * The environment a bounded check gets: only the allowlisted names of the daemon's own, with
 * their own spelling, and `CI=1`. Keys and Flightdeck's variables stay out (#1361).
 */
export function checkEnvironment(
  source: Record<string, string | undefined>,
  platform: string,
  extra: readonly string[] = [],
): Record<string, string> {
  const windows = platform === "win32";
  // The project's names are checked again at use: the stored list is never trusted blindly.
  const added = new Set(
    extra.filter(isCheckEnvName).map((name) => (windows ? name.toUpperCase() : name)),
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    const key = windows ? name.toUpperCase() : name;
    const kept = (windows ? WINDOWS_ENV.has(key) : POSIX_ENV.has(name)) || added.has(key);
    if (kept && value !== undefined) env[name] = value;
  }
  env.CI = "1";
  return env;
}
