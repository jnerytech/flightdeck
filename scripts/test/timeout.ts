/**
 * The default timeout of a test, in ms. It guards against a hang, it is not a time budget: the
 * Windows runners of CI are slow enough that a test which takes 1 s elsewhere can pass 5 s there.
 * Nothing may depend on it being short.
 */
export function defaultTestTimeoutMs(platform: NodeJS.Platform): number {
  return platform === "win32" ? 15_000 : 5_000;
}

/** The `bun` arguments of the full suite. */
export function testArgs(platform: NodeJS.Platform, extra: string[]): string[] {
  // A flag, not a setDefaultTimeout in the preload: bun keeps that one for the first file only.
  // A file that calls setDefaultTimeout itself still wins.
  return ["test", `--timeout=${defaultTestTimeoutMs(platform)}`, ...extra];
}
