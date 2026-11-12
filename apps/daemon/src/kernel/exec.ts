/** Runs a command and returns its exit code and stdout. */
export type Exec = (cmd: string[]) => Promise<{ code: number; stdout: string }>;

export const spawnExec: Exec = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
};
