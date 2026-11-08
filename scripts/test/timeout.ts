/**
 * The default timeout of a test, in ms. It guards against a hang, it is not a time budget: a UI
 * test's first render loads the lazy screens inside the test, and a loaded runner (a Windows CI
 * job, a Pi running several sessions) passes bun's 5 s with nothing wrong. Nothing may depend on
 * it being short, and no file should need its own bump for a slow first render. Windows gets
 * twice the room (#534): its runners are the slow ones, and a different test hit 15 s on each of
 * 4 of 30 shard jobs. Linux stays at 15 s so it keeps catching real slowness.
 */
export function defaultTestTimeoutMs(platform: NodeJS.Platform): number {
  return platform === "win32" ? 30_000 : 15_000;
}

/**
 * The `bun` arguments of the full suite. With `junit`, bun also writes each test's time there
 * (#1003); the console output stays as it is.
 */
export function testArgs(platform: NodeJS.Platform, extra: string[], junit?: string): string[] {
  // A flag, not a setDefaultTimeout in the preload: bun keeps that one for the first file only.
  // A file that calls setDefaultTimeout itself still wins.
  const times = junit ? ["--reporter=junit", `--reporter-outfile=${junit}`] : [];
  return ["test", `--timeout=${defaultTestTimeoutMs(platform)}`, ...times, ...extra];
}
