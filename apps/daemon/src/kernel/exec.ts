/** Runs a command and returns its exit code and stdout. */
export type Exec = (cmd: string[]) => Promise<{ code: number; stdout: string }>;

export const spawnExec: Exec = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
};

/** What a command may print before it is cut: a helper's answer is a token or an address, far smaller. */
const MAX_BUFFER = 8192;

/** Like `spawnExec`, but a command that does not end in `timeoutMs`, or prints more than it should, is killed and fails: it never hangs the caller or fills its memory. */
export function boundedExec(timeoutMs: number): Exec {
  return async (cmd) => {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: MAX_BUFFER,
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    // A command that was killed has no exit code of its own: that is a failure, whatever it printed.
    return proc.signalCode ? { code: 1, stdout: "" } : { code, stdout };
  };
}
