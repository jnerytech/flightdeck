/**
 * The terminal's process (#1612): the one place the terminal domain starts one, with Bun's PTY
 * support (a ConPTY on Windows). `bunPty` builds the argument list (never a shell line), the
 * working folder and the explicit environment; this starts them.
 */

/** What the terminal domain uses of the process Bun starts (structural, so this file imports nothing from the domain). */
interface PtyProcess {
  pid?: number;
  exited: Promise<number>;
  terminal?: { write(data: string): number; resize(cols: number, rows: number): void };
  kill(signal?: string): void;
}

/** Starts `argv` as it is given: no shell, and the options (cwd, env, terminal) exactly as `bunPty` built them. */
export const spawnPty = (argv: string[], options: Record<string, unknown>): PtyProcess =>
  (Bun.spawn as unknown as (argv: string[], options: Record<string, unknown>) => PtyProcess)(
    argv,
    options,
  );
