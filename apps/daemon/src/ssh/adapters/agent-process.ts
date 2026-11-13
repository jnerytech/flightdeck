/**
 * The real `ssh-agent` and `ssh-add` as processes (#1612): the one place the ssh domain starts them
 * for a connection's key. The delivery decides what runs and with which environment; this runs it.
 */
import { access } from "node:fs/promises";
import type { AgentOps } from "../key-delivery.ts";

type Spawn = (
  cmd: string[],
  options: {
    env: Record<string, string | undefined>;
    stdin: "ignore" | "pipe";
    stdout: "ignore";
    stderr: "ignore";
  },
) => {
  stdin: { write(text: string): unknown; end(): unknown };
  exited: Promise<number>;
  kill(): void;
};

const SOCKET_LOOKS = 40;

const pathExists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The real `ssh-agent` and `ssh-add`, over an injectable `spawn`. */
export function processOps(
  spawn: Spawn = Bun.spawn as unknown as Spawn,
  exists: (path: string) => boolean | Promise<boolean> = pathExists,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
): AgentOps {
  return {
    startAgent: (sock) => {
      const proc = spawn(["ssh-agent", "-D", "-a", sock], {
        env: process.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      return { stop: () => proc.kill() };
    },
    waitForSocket: async (sock) => {
      for (let look = 0; look < SOCKET_LOOKS; look++) {
        if (await exists(sock)) return true; // NOSONAR: retry: an attempt starts only after the one before has not worked
        await sleep(50); // NOSONAR: poll interval: the wait between looks is the point of this loop
      }
      return false;
    },
    run: async (cmd, options) => {
      const proc = spawn(cmd, {
        env: options.env,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(options.stdin);
      proc.stdin.end();
      return { code: await proc.exited };
    },
  };
}
