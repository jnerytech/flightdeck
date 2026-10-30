/** A PTY the terminal manager drives; the real one is Bun's, tests inject a fake. */
export interface PtyStart {
  argv: string[];
  cwd: string;
  /** Always explicit: `Bun.spawn` without it would use the environment the process started with. */
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData(chunk: Uint8Array): void;
  /** The process ended (its exit code), after the last byte of output was read. */
  onExit(exitCode: number): void;
}

export interface Pty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtyFactory = (start: PtyStart) => Pty;

/** The part of `Bun.spawn` the adapter uses. */
export type SpawnFn = (argv: string[], options: Record<string, unknown>) => SpawnedProcess;

export interface SpawnedProcess {
  exited: Promise<number>;
  terminal?: { write(data: string): number; resize(cols: number, rows: number): void } | undefined;
  kill(signal?: string): void;
}

/** How long a killed process gets to end after SIGHUP before SIGKILL. */
const KILL_GRACE_MS = 2000;

/** How long after the process ended the end of its output is waited for. */
const EOF_GRACE_MS = 100;

/**
 * Bun's PTY (a ConPTY on Windows). `spawn` is injectable so the mapping can be tested without a
 * real terminal. The exit code is the process's (`exited`): the terminal's own `exit` callback
 * only says the output stream closed, so the code is reported once both have happened (or the
 * stream stays silent for a moment after the process ended).
 */
export function bunPty(
  spawn: SpawnFn = Bun.spawn as unknown as SpawnFn,
  killGraceMs = KILL_GRACE_MS,
): PtyFactory {
  return (start) => {
    let exitCode: number | null = null;
    let drained = false;
    let reported = false;
    const report = () => {
      if (reported || exitCode === null || !drained) return;
      reported = true;
      start.onExit(exitCode);
    };
    const proc = spawn(start.argv, {
      cwd: start.cwd,
      env: start.env,
      terminal: {
        cols: start.cols,
        rows: start.rows,
        data: (_terminal: unknown, chunk: Uint8Array) => start.onData(chunk),
        exit: () => {
          drained = true;
          report();
        },
      },
    });
    let ended = false;
    void proc.exited.then((code) => {
      ended = true;
      exitCode = code;
      setTimeout(() => {
        drained = true;
        report();
      }, EOF_GRACE_MS);
      report();
    });
    return {
      write: (data) => {
        proc.terminal?.write(data);
      },
      resize: (cols, rows) => {
        proc.terminal?.resize(cols, rows);
      },
      // SIGHUP is what a closing terminal sends: an interactive shell ignores SIGTERM but not
      // SIGHUP, and passes it on to its jobs. Whatever is still there after the grace is killed.
      // On Windows the signal is ignored and the process is terminated.
      kill: () => {
        proc.kill("SIGHUP");
        setTimeout(() => {
          if (!ended) proc.kill("SIGKILL");
        }, killGraceMs);
      },
    };
  };
}
