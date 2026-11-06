import { linesOf } from "../lines.ts";
import { REAL_KILL_DEPS, treeKiller } from "./opencode-runtime.ts";

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

const REAL_TIMERS = {
  set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clear: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Ends a process's group with SIGKILL, as nothing it holds is worth waiting for. Built when used:
 * opencode-runtime reaches this module through the preflight, so its exports are not there yet
 * while this one loads.
 */
const kill = (child: Parameters<ReturnType<typeof treeKiller>>[0]) =>
  treeKiller(process.platform, REAL_KILL_DEPS)(child, true);

const LISTENING = /listening on (https?:\/\/\S+)/;

/** Starts `opencode serve` on a free loopback port and waits until it says where it listens. */
export async function startPrivateServer(opts: ServeOptions): Promise<PrivateServer> {
  const timers = opts.timers ?? REAL_TIMERS;
  const password = crypto.randomUUID();
  const child = Bun.spawn([opts.path, "serve", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd: opts.cwd,
    env: { ...opts.env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    // Its own process group on POSIX, so ending it reaches what it started.
    detached: process.platform !== "win32",
  });
  let stopping: Promise<void> | null = null;
  let listening = false;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (child.exitCode === null) kill(child);
      await child.exited;
      if (listening) opts.ledger?.release(child.pid);
    })();
    return stopping;
  };

  let limit: unknown;
  const url = await new Promise<string>((resolve, reject) => {
    limit = timers.set(
      () => reject(new ServeFailed("opencode serve did not listen in time")),
      opts.timeoutMs,
    );
    // The output is read to the end, so a server that prints more never blocks on a full pipe.
    void (async () => {
      let said = false;
      for await (const line of linesOf(child.stdout)) {
        const found = said ? null : LISTENING.exec(line);
        if (found?.[1]) {
          said = true;
          resolve(found[1]);
        }
      }
    })();
    void child.exited.then((code) => reject(new ServeFailed(`opencode serve exited ${code}`)));
  }).catch(async (error: unknown) => {
    timers.clear(limit);
    await stop();
    throw error;
  });
  timers.clear(limit);
  listening = true;
  opts.ledger?.add(child.pid);

  const authorization = `Basic ${btoa(`opencode:${password}`)}`;
  return {
    url,
    pid: child.pid,
    stop,
    async get(route) {
      const controller = new AbortController();
      const limit = timers.set(() => controller.abort(), opts.timeoutMs);
      try {
        const response = await fetch(`${url}${route}`, {
          headers: { authorization },
          signal: controller.signal,
        });
        if (!response.ok) throw new ServeFailed(`${route} answered HTTP ${response.status}`);
        try {
          return (await response.json()) as unknown;
        } catch {
          // The parser's message quotes the body, which is not for logs.
          throw new ServeFailed(`${route} answered something that is not JSON`);
        }
      } catch (error) {
        if (error instanceof ServeFailed) throw error;
        if (controller.signal.aborted) throw new ServeFailed(`${route} did not answer in time`);
        throw new ServeFailed(`${route} could not be asked`);
      } finally {
        timers.clear(limit);
      }
    },
  };
}
