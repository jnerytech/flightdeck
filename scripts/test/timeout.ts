/**
 * The default timeout of a test, in ms. It guards against a hang, it is not a time budget: a UI
 * test's first render loads the lazy screens inside the test, and a loaded runner (a Windows CI
 * job, a Pi running several sessions) passes bun's 5 s with nothing wrong. Nothing may depend on
 * it being short, and no file should need its own bump for a slow first render.
 */
export function defaultTestTimeoutMs(_platform: NodeJS.Platform): number {
  return 15_000;
}

/** The `bun` arguments of the full suite. */
export function testArgs(platform: NodeJS.Platform, extra: string[]): string[] {
  // A flag, not a setDefaultTimeout in the preload: bun keeps that one for the first file only.
  // A file that calls setDefaultTimeout itself still wins.
  return ["test", `--timeout=${defaultTestTimeoutMs(platform)}`, ...extra];
}
