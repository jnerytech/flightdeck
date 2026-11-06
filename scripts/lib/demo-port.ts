/** The port of the demo's Vite: `DEMO_PORT`, a free one for the runs of a machine, 1420 for a person. */
export const DEFAULT_DEMO_PORT = 1420;

/** A port nobody listens on right now (the OS picks it). */
export async function freePort(): Promise<number> {
  return 0;
}

/**
 * The port the demo serves on. `DEMO_PORT` wins; the e2e run (`--serve`) and the prints (`--shots`)
 * take a free one, so a demo a session keeps open never blocks another session's run; a plain
 * `bun run demo` keeps the port a person types into the browser.
 */
export async function demoPort(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  free: () => Promise<number>,
): Promise<number> {
  void env;
  void argv;
  void free;
  return 0;
}
