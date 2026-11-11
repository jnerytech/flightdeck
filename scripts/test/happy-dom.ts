/**
 * Which runs get the DOM of the desktop tests (#2006): the preload gives it (`apps/desktop/test/dom-global.ts`) to a run that touches them before the
 * first test file loads anything: a file that imports the app store without a DOM loads the UI
 * libraries (Radix, React) with `document` missing, they keep that for the whole process, and the
 * UI test that runs after it cannot open a menu. Which files share a process changes with every
 * move of a test, so no file may depend on the order.
 */

/** Whether a `bun test` run, by its argv, includes desktop tests: no path at all means the whole suite. */
export function runsDesktopTests(argv: readonly string[]): boolean {
  const paths = argv.slice(1);
  if (paths.length === 0) return true;
  return paths.some((path) => path.replaceAll("\\", "/").includes("apps/desktop"));
}
