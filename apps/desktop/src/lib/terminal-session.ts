import type { TerminalAttachResult } from "@flightdeck/protocol";

/** The host's side of one terminal, as the app drives it. */
export interface TerminalHost {
  attach(terminalId: string): Promise<TerminalAttachResult>;
  ack(terminalId: string, bytes: number): Promise<unknown>;
  write(terminalId: string, data: string): Promise<unknown>;
  resize(terminalId: string, cols: number, rows: number): Promise<unknown>;
  close(terminalId: string, kill: boolean): Promise<unknown>;
}

/** What draws the output (xterm in the app). */
export interface TerminalScreen {
  /** `done` runs once xterm has drawn the bytes. */
  write(bytes: Uint8Array, done?: () => void): void;
  reset(): void;
}

export type TerminalState = "attaching" | "live" | "detached" | "ended";

export type Schedule = (run: () => void, ms: number) => () => void;

export interface TerminalSessionOptions {
  terminalId: string;
  host: TerminalHost;
  screen: TerminalScreen;
  onState(state: TerminalState, exitCode: number | null): void;
  schedule?: Schedule;
}

/** Drawn output is acknowledged to the host in steps of at least this many bytes. */
export const ACK_BYTES = 64 * 1024;

/** The debounce of `terminal.resize` while a tab is being resized. */
export const RESIZE_DEBOUNCE_MS = 100;

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** base64 to bytes with what the browser has (Node's Buffer is not there). */
const decode = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/** One terminal as the app follows it: attach, draw, type, resize, detach and close. */
export class TerminalSession {
  state: TerminalState = "detached";
  exitCode: number | null = null;
  private cancelResize: (() => void) | null = null;

  constructor(readonly opts: TerminalSessionOptions) {}

  /** Attaches and draws what the host kept; also the way to reopen a detached terminal. */
  async start(): Promise<void> {
    this.set("attaching", null);
    try {
      const attached = await this.opts.host.attach(this.opts.terminalId);
      this.opts.screen.reset();
      this.opts.screen.write(decode(attached.scrollback));
      this.set(attached.exitCode === null ? "live" : "ended", attached.exitCode);
    } catch {
      this.set("detached", null);
    }
  }

  data(base64: string): void {
    this.opts.screen.write(decode(base64));
  }

  exited(exitCode: number): void {
    this.set("ended", exitCode);
  }

  disconnected(): void {
    if (this.state !== "ended") this.set("detached", null);
  }

  input(data: string): void {
    if (this.state !== "live") return;
    this.opts.host.write(this.opts.terminalId, data).catch(() => {});
  }

  resize(cols: number, rows: number): void {
    this.cancelResize?.();
    const schedule = this.opts.schedule ?? defaultSchedule;
    this.cancelResize = schedule(() => {
      this.opts.host.resize(this.opts.terminalId, cols, rows).catch(() => {});
    }, RESIZE_DEBOUNCE_MS);
  }

  reopen(): Promise<void> {
    return this.start();
  }

  /** Ends the process (`kill`) or only detaches from it. */
  async close(kill: boolean): Promise<void> {
    await this.opts.host.close(this.opts.terminalId, kill).catch(() => {});
  }

  dispose(): void {
    this.cancelResize?.();
    this.cancelResize = null;
  }

  private set(state: TerminalState, exitCode: number | null): void {
    this.state = state;
    this.exitCode = exitCode;
    this.opts.onState(state, exitCode);
  }
}
