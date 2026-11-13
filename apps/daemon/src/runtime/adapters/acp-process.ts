/**
 * The `opencode acp` agent as a process (#1612): the one place the runtime starts an Agent Client
 * Protocol peer from. The ACP client talks to what it returns; this only launches and wires stdio.
 */
import { linesOf } from "../../kernel/index.ts";
import type { SpawnedAcp } from "../acp/client.ts";

/** Starts the agent with piped stdio; its stderr is dropped (it may echo prompts). */
export function spawnAcp(
  argv: string[],
  opts: { cwd: string; env: Record<string, string> },
): SpawnedAcp {
  const child = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    // Its own process group on POSIX, so a tree kill reaches what it started.
    detached: process.platform !== "win32",
  });
  return {
    lines: linesOf(child.stdout),
    write(line) {
      child.stdin.write(`${line}\n`);
      void child.stdin.flush();
    },
    close() {
      void child.stdin.end();
    },
    kill() {
      child.kill();
    },
    exited: child.exited,
    pid: child.pid,
  };
}
