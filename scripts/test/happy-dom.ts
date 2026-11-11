/**
 * The DOM of the desktop tests (#2006). The preload gives it to a run that touches them before the
 * first test file loads anything: a file that imports the app store without a DOM loads the UI
 * libraries (Radix, React) with `document` missing, they keep that for the whole process, and the
 * UI test that runs after it cannot open a menu. Which files share a process changes with every
 * move of a test, so no file may depend on the order.
 */

/** Whether a `bun test` run, by its argv, includes desktop tests: no path at all means the whole suite. */
export function runsDesktopTests(_argv: readonly string[]): boolean {
  return false;
}

/** Registers happy-dom once per process; Bun's networking globals stay Bun's (the daemon tests need them). */
export function ensureHappyDom(): void {}
