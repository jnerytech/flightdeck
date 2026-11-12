import { createServer } from "node:net";

/** The port of the demo's Vite: `DEMO_PORT`, a free one for the runs of a machine, 1420 for a person. */
export const DEFAULT_DEMO_PORT = 1420;

/** A port nobody listens on right now (the OS picks it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
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
  const set = env.DEMO_PORT;
  if (set !== undefined && set !== "") {
    const port = Number(set);
    if (!/^\d+$/.test(set) || port < 1 || port > 65_535) {
      throw new Error(`DEMO_PORT=${set} is not a port (1 to 65535)`);
    }
    return port;
  }
  return argv.includes("--serve") || argv.includes("--shots") ? await free() : DEFAULT_DEMO_PORT;
}
