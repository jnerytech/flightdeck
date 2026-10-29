import type { Pty, PtyFactory, PtyStart } from "../src/terminal/pty.ts";
import type { TerminalFrame, TerminalSink } from "../src/terminal/terminal-manager.ts";

const encoder = new TextEncoder();

/** What the test sees of one fake PTY, and the hands to drive it. */
export interface FakePty {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  written: string[];
  resized: Array<[number, number]>;
  killed: boolean;
  /** Output of the process. */
  emit(data: string | Uint8Array): void;
  /** The process ends by itself. */
  exit(code: number): void;
}

/**
 * Fake PTYs that are a small echo script: what is written comes back as output, and a line
 * saying `size` is answered with the terminal's size. Killing one ends it with 143, like a
 * SIGTERM. Nothing here ever opens a real shell.
 */
export function fakePtys() {
  const spawned: FakePty[] = [];
  const factory: PtyFactory = (start: PtyStart): Pty => {
    const fake: FakePty = {
      argv: start.argv,
      cwd: start.cwd,
      env: start.env,
      cols: start.cols,
      rows: start.rows,
      written: [],
      resized: [],
      killed: false,
      emit: (data) => start.onData(typeof data === "string" ? encoder.encode(data) : data),
      exit: (code) => start.onExit(code),
    };
    spawned.push(fake);
    return {
      write: (data) => {
        fake.written.push(data);
        fake.emit(data);
        if (/size[\r\n]/.test(data)) fake.emit(`${fake.cols}x${fake.rows}\r\n`);
      },
      resize: (cols, rows) => {
        fake.resized.push([cols, rows]);
        fake.cols = cols;
        fake.rows = rows;
      },
      kill: () => {
        fake.killed = true;
        fake.exit(143);
      },
    };
  };
  return { spawned, factory };
}

export type FakeSink = TerminalSink & { frames: TerminalFrame[]; backlogBytes: number };

/** One connection's end: records the frames; `backlogBytes` is what its socket has queued. */
export function fakeSink(): FakeSink {
  const sink: FakeSink = {
    frames: [],
    backlogBytes: 0,
    send: (frame) => {
      sink.frames.push(frame);
    },
    backlog: () => sink.backlogBytes,
  };
  return sink;
}

/** The bytes of the `terminal.data` frames, in order. */
export function dataOf(frames: TerminalFrame[]): Buffer {
  return Buffer.concat(
    frames.flatMap((f) => (f.type === "terminal.data" ? [Buffer.from(f.data, "base64")] : [])),
  );
}
