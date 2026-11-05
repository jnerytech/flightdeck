/**
 * One private `opencode serve` for a whole preflight (issue #243): started with Flightdeck's
 * environment (project config off, our document inline), asked the checks over HTTP and stopped,
 * instead of one `api --standalone` boot per check. It listens on loopback only and wants a random
 * password, so another user of the machine cannot ask it anything.
 */

/** A server that did not start or did not answer; its message names the route or the exit, never what OpenCode printed. */
export class ServeFailed extends Error {}

export interface PrivateServer {
  /** The route's answer, parsed; throws ServeFailed. */
  get(route: string): Promise<unknown>;
  /** Ends the server and its group; twice is once. */
  stop(): Promise<void>;
  /** For the tests: the base URL and the process. */
  readonly url: string;
  readonly pid: number;
}

export interface ServeOptions {
  path: string;
  cwd: string;
  env: Record<string, string>;
  /** The limit of the start and of each route. */
  timeoutMs: number;
  /** Where the process group is written down for a daemon that is killed. */
  ledger?: { add(pid: number): void; release(pid: number): void };
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
}

export function startPrivateServer(_opts: ServeOptions): Promise<PrivateServer> {
  return Promise.resolve({
    get: async () => null,
    stop: async () => {},
    url: "",
    pid: 0,
  });
}
