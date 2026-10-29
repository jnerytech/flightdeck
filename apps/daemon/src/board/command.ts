import { whichOnPath } from "../which.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command in `cwd` and collects its exit code and output; `input` goes to its stdin. */
export async function runCommand(
  cmd: string[],
  cwd: string,
  input?: string,
): Promise<CommandResult> {
  // `env` explicitly: without it Bun passes the environment the process started with.
  const proc = Bun.spawn(cmd, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** `git` from the current PATH, always with an explicit working directory. */
export function git(cwd: string, ...args: string[]): Promise<CommandResult> {
  return runCommand([whichOnPath("git") ?? "git", ...args], cwd);
}
