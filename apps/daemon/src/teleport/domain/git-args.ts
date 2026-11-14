/** The `core.hooksPath` that holds no hook, on this platform. */
export const hooksOff = (platform: NodeJS.Platform): string =>
  platform === "win32" ? "NUL" : "/dev/null";

/** No hook, fsmonitor or signature check (gpg.program) of the repository runs. */
export const safeArgs = (platform: NodeJS.Platform): string[] => [
  "-c",
  `core.hooksPath=${hooksOff(platform)}`,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "log.showSignature=false",
];
