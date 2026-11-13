/**
 * The ssh program as a process (#1612): the one place the daemon launches `ssh` from. The
 * connector hands it an argument list and an environment and gets back what ssh printed.
 */
import type { ExecSsh, RunSsh } from "../connect.ts";

type SpawnRun = (
  cmd: string[],
  options: {
    env: Record<string, string | undefined>;
    stdin: "ignore";
    stdout: "ignore";
    stderr: "pipe";
  },
) => { stderr: ReadableStream<Uint8Array>; exited: Promise<number> };

export function processRun(spawn: SpawnRun = Bun.spawn as unknown as SpawnRun): RunSsh {
  return async (argv, env) => {
    const proc = spawn(argv, {
      env: { ...process.env, ...env },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return { code, stderr };
  };
}

export function processExec(): ExecSsh {
  return async (argv, env, input, timeoutMs) => {
    const proc = Bun.spawn(argv, {
      env: { ...process.env, ...env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    proc.stdin.write(input);
    await proc.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr, timedOut };
  };
}
