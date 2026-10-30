import type { TerminalData, TerminalExited, TerminalResync } from "@flightdeck/protocol";
import { TERMINAL_LAUNCH_VAR } from "../central/wrapper.ts";
import { buildChildEnv } from "../env.ts";
import { FlightdeckError } from "../errors.ts";
import { resolveAllowedCwd } from "../paths.ts";
import type { Timers } from "../quota/quota.ts";
import { ulid } from "../ulid.ts";
import { whichOnPath } from "../which.ts";
import type { Pty, PtyFactory } from "./pty.ts";
import { Ring } from "./ring.ts";
import { defaultShell } from "./shell.ts";

/** What the manager sends a connected client. */
export type TerminalFrame = TerminalData | TerminalExited | TerminalResync;

/** One connection's end of its attached terminals. */
export interface TerminalSink {
  send(frame: TerminalFrame): void;
  /** Bytes the connection has queued and not yet sent (`ws.getBufferedAmount()`). */
  backlog(): number;
}

export interface TerminalInfo {
  terminalId: string;
  cwd: string;
  /** The program only, never its arguments. */
  command: string;
  startedAt: string;
  attached: number;
  cols: number;
  rows: number;
  exitCode: number | null;
  launchId: string | null;
}

export interface AttachResult {
  terminalId: string;
  /** base64 of what the terminal kept of its output (at most 2 MB). */
  scrollback: string;
  cols: number;
  rows: number;
  exitCode: number | null;
}

export interface TerminalSettings {
  enabled: boolean;
  max: number;
  /** The program of the default shell. */
  shell: string;
}

export interface OpenRequest {
  cwd: string;
  /** An argv, never run through a shell; the host's default shell when absent. */
  command?: string[];
  /** "Claude aqui": `flightdeckd claude` in the cwd, optionally `--resume <id>`. */
  claude?: { resume?: string };
  /** Variables added to the process environment. For code of the daemon, not for clients. */
  env?: Record<string, string>;
  /** The cwd is the daemon own folder: it needs no place in `allowedRoots`. Daemon code only. */
  internal?: boolean;
  /** Called when the process ends. Daemon code only. */
  onExit?: () => void;
  cols: number;
  rows: number;
}

export interface TerminalManagerOptions {
  pty: PtyFactory;
  /** Whether terminals may be opened now; on when absent. */
  enabled?: boolean;
  allowedRoots: readonly string[];
  /** Live terminals at most; 10 when absent. */
  max?: number;
  /** Minutes without anyone attached before a terminal is ended; 120 when absent. */
  idleMinutes?: number;
  /** The environment terminals inherit; the process's when absent. */
  env?: () => Record<string, string | undefined>;
  /** This daemon's own command line and config, which "Claude aqui" runs `claude` through. */
  claude?: { self: string[]; configFile: string };
  /** Keep the API-key variables (`allowApiKey` of the config); dropped when absent. */
  allowApiKey?: boolean;
  platform?: NodeJS.Platform;
  which?: (name: string) => string | null;
  timers?: Timers;
  now?: () => number;
  /** Open, attach and end, never the content. */
  log?: (message: string) => void;
}

/** What each terminal keeps of its output. */
export const SCROLLBACK_BYTES = 2 * 1024 * 1024;
/** What is held for one client whose connection is full, before it is asked to resync. */
const QUEUE_LIMIT_BYTES = 1024 * 1024;
/** A connection with more than this queued gets no more until it empties. */
const BACKLOG_LIMIT_BYTES = 1024 * 1024;
const BATCH_BYTES = 16 * 1024;
const FLUSH_MS = 16;
const DEFAULT_MAX = 10;
const DEFAULT_IDLE_MINUTES = 120;

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Client {
  sink: TerminalSink;
  /** Output not yet sent to this client. */
  queue: Uint8Array[];
  queued: number;
  /** The queue overflowed: nothing goes to this client until it attaches again. */
  resync: boolean;
  exitSent: boolean;
}

interface Entry {
  id: string;
  cwd: string;
  program: string;
  startedAt: string;
  cols: number;
  rows: number;
  launchId: string | null;
  pty: Pty;
  ring: Ring;
  clients: Map<TerminalSink, Client>;
  /** Run when the process ends (daemon code that opened it). */
  afterExit: (() => void) | undefined;
  exitCode: number | null;
  /** Being ended on purpose: it goes when the process does. */
  closing: boolean;
  idle: unknown;
}

/** The program of an argv, without its folder. */
const programOf = (argv: string[]) => (argv[0] ?? "").split(/[\\/]/).pop() || (argv[0] ?? "");

/**
 * Terminals of the host: real shells behind a PTY, kept alive across connections. The PTY is
 * always read; what it writes goes into a ring (the source of truth) and into one bounded queue
 * per attached client. Bun's PTY cannot pause reading, so a client too slow to follow is told to
 * `resync`: it attaches again and continues from the ring.
 */
export class TerminalManager {
  private readonly entries = new Map<string, Entry>();
  private readonly timers: Timers;
  private readonly now: () => number;
  private flushTimer: unknown = null;
  private on: boolean;

  constructor(readonly opts: TerminalManagerOptions) {
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? Date.now;
    this.on = opts.enabled ?? true;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Turning it off ends every live terminal, or shells would run where no one can reach them. */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.log("terminal ligado");
      return;
    }
    const ended = this.killAll();
    this.log(`terminal desligado (${ended} encerrado${ended === 1 ? "" : "s"})`);
  }

  /** What `host.info` says about the terminals. */
  settings(): TerminalSettings {
    const shell = defaultShell({
      platform: this.opts.platform ?? process.platform,
      env: (this.opts.env ?? (() => process.env))(),
      which: this.opts.which ?? whichOnPath,
    });
    return { enabled: this.on, max: this.opts.max ?? DEFAULT_MAX, shell: programOf(shell) };
  }

  /** Every terminal command goes through here: a host with the terminal off refuses them. */
  private assertOn(): void {
    if (!this.on) throw new FlightdeckError("terminal_disabled", "terminal desligado neste host");
  }

  private log(message: string): void {
    this.opts.log?.(message);
  }

  private live(): number {
    return [...this.entries.values()].filter((e) => e.exitCode === null && !e.closing).length;
  }

  private get(terminalId: string): Entry {
    const entry = this.entries.get(terminalId);
    if (!entry) throw new FlightdeckError("not_found", `terminal ${terminalId} não existe`);
    return entry;
  }

  private running(terminalId: string): Entry {
    const entry = this.get(terminalId);
    if (entry.exitCode !== null || entry.closing) {
      throw new FlightdeckError("invalid_state", `terminal ${terminalId} já terminou`);
    }
    return entry;
  }

  private info(entry: Entry): TerminalInfo {
    return {
      terminalId: entry.id,
      cwd: entry.cwd,
      command: entry.program,
      startedAt: entry.startedAt,
      attached: entry.clients.size,
      cols: entry.cols,
      rows: entry.rows,
      exitCode: entry.exitCode,
      launchId: entry.launchId,
    };
  }

  open(req: OpenRequest): TerminalInfo {
    this.assertOn();
    const cwd = req.internal ? req.cwd : resolveAllowedCwd(req.cwd, this.opts.allowedRoots);
    const max = this.opts.max ?? DEFAULT_MAX;
    if (this.live() >= max) {
      throw new FlightdeckError("invalid_state", `limite de ${max} terminais por host`);
    }
    const env = (this.opts.env ?? (() => process.env))();
    const id = ulid(this.now());
    let argv: string[];
    let launchId: string | null = null;
    let extraEnv: Record<string, string> = {};
    if (req.claude) {
      const claude = this.opts.claude;
      if (!claude) {
        throw new FlightdeckError("invalid_state", "Claude aqui indisponível neste host");
      }
      // The launch that `flightdeckd claude` will register: the session it opens is this one.
      launchId = ulid(this.now());
      argv = [
        ...claude.self,
        "claude",
        ...(req.claude.resume ? ["--resume", req.claude.resume] : []),
      ];
      extraEnv = { FLIGHTDECK_CONFIG: claude.configFile, [TERMINAL_LAUNCH_VAR]: launchId };
    } else {
      argv =
        req.command ??
        defaultShell({
          platform: this.opts.platform ?? process.platform,
          env,
          which: this.opts.which ?? whichOnPath,
        });
    }
    let pty: Pty;
    try {
      pty = this.opts.pty({
        argv,
        cwd,
        env: { ...buildChildEnv(env, this.opts.allowApiKey ?? false), ...extraEnv, ...req.env },
        cols: req.cols,
        rows: req.rows,
        onData: (chunk) => this.onData(id, chunk),
        onExit: (exitCode) => this.onExit(id, exitCode),
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new FlightdeckError("invalid_state", `não consegui abrir o terminal: ${why}`);
    }
    const entry: Entry = {
      id,
      cwd,
      program: programOf(argv),
      startedAt: new Date(this.now()).toISOString(),
      cols: req.cols,
      rows: req.rows,
      launchId,
      pty,
      ring: new Ring(SCROLLBACK_BYTES),
      clients: new Map(),
      afterExit: req.onExit,
      exitCode: null,
      closing: false,
      idle: null,
    };
    this.entries.set(id, entry);
    this.startIdle(entry);
    this.log(`terminal ${id} aberto em ${cwd} (${entry.program})`);
    return this.info(entry);
  }

  write(terminalId: string, data: string): void {
    this.assertOn();
    this.running(terminalId).pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.assertOn();
    const entry = this.running(terminalId);
    entry.pty.resize(cols, rows);
    entry.cols = cols;
    entry.rows = rows;
  }

  /**
   * The connection follows the terminal from now on. Attaching again (after a `resync`) starts
   * the queue over: the scrollback returned is the position to continue from.
   */
  attach(terminalId: string, sink: TerminalSink): AttachResult {
    this.assertOn();
    const entry = this.get(terminalId);
    const exited = entry.exitCode !== null;
    entry.clients.set(sink, {
      sink,
      queue: [],
      queued: 0,
      resync: false,
      // The result already says it ended.
      exitSent: exited,
    });
    if (!exited) this.clearIdle(entry);
    this.log(`terminal ${terminalId} anexado (${entry.clients.size})`);
    return {
      terminalId,
      scrollback: Buffer.from(entry.ring.snapshot()).toString("base64"),
      cols: entry.cols,
      rows: entry.rows,
      exitCode: entry.exitCode,
    };
  }

  detach(terminalId: string, sink: TerminalSink): void {
    this.assertOn();
    this.release(terminalId, sink);
  }

  private release(terminalId: string, sink: TerminalSink): void {
    const entry = this.get(terminalId);
    if (!entry.clients.delete(sink)) return;
    this.log(`terminal ${terminalId} desanexado (${entry.clients.size})`);
    if (entry.exitCode === null && entry.clients.size === 0) this.startIdle(entry);
  }

  /** The connection is gone: every terminal it was attached to keeps running. */
  detachAll(sink: TerminalSink): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.clients.has(sink)) this.release(entry.id, sink);
    }
  }

  /**
   * With `kill`, ends the process (the terminal goes when it does). Without it, only detaches:
   * `sink` alone, or every client when no connection is named; a terminal that already ended is
   * removed.
   */
  close(terminalId: string, kill: boolean, sink?: TerminalSink): void {
    this.assertOn();
    const entry = this.get(terminalId);
    if (entry.exitCode !== null) {
      this.remove(entry);
      return;
    }
    if (kill) {
      entry.closing = true;
      entry.pty.kill();
      return;
    }
    for (const client of sink ? [sink] : [...entry.clients.keys()])
      this.release(terminalId, client);
  }

  list(): TerminalInfo[] {
    this.assertOn();
    return [...this.entries.values()].map((entry) => this.info(entry));
  }

  /** The daemon is stopping: no terminal outlives it. */
  stop(): void {
    if (this.flushTimer !== null) this.timers.clear(this.flushTimer);
    this.flushTimer = null;
    this.killAll();
  }

  /** Ends every live terminal and forgets them all; returns how many were running. */
  private killAll(): number {
    let ended = 0;
    for (const entry of [...this.entries.values()]) {
      this.clearIdle(entry);
      entry.closing = true;
      if (entry.exitCode === null) {
        entry.pty.kill();
        ended++;
      }
    }
    this.entries.clear();
    return ended;
  }

  // -- output -----------------------------------------------------------------

  private onData(id: string, chunk: Uint8Array): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.ring.append(chunk);
    const copy = chunk.slice();
    for (const client of entry.clients.values()) {
      if (client.resync) continue;
      client.queue.push(copy);
      client.queued += copy.length;
      // Held back because the connection is full, and over what is kept for it: it resyncs.
      if (client.queued > QUEUE_LIMIT_BYTES && client.sink.backlog() > BACKLOG_LIMIT_BYTES) {
        client.queue = [];
        client.queued = 0;
        client.resync = true;
        client.sink.send({ type: "terminal.resync", terminalId: id });
      }
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = this.timers.set(() => {
      this.flushTimer = null;
      let held = false;
      for (const entry of this.entries.values()) held = this.flush(entry) || held;
      // Something is held for a full connection: look again in a moment.
      if (held) this.scheduleFlush();
    }, FLUSH_MS);
  }

  /** Sends what each client can take, in frames of at most 16 KB; true when something is held. */
  private flush(entry: Entry): boolean {
    let held = false;
    for (const client of entry.clients.values()) {
      while (!client.resync && client.queued > 0 && client.sink.backlog() <= BACKLOG_LIMIT_BYTES) {
        client.sink.send({
          type: "terminal.data",
          terminalId: entry.id,
          data: Buffer.from(this.take(client)).toString("base64"),
        });
      }
      if (!client.resync && client.queued > 0) {
        held = true;
      } else if (entry.exitCode !== null && !client.exitSent) {
        client.exitSent = true;
        client.sink.send({
          type: "terminal.exited",
          terminalId: entry.id,
          exitCode: entry.exitCode,
        });
      }
    }
    return held;
  }

  /** The next batch of at most 16 KB from a client's queue. */
  private take(client: Client): Uint8Array {
    const out = new Uint8Array(Math.min(BATCH_BYTES, client.queued));
    let filled = 0;
    while (filled < out.length) {
      const head = client.queue[0] as Uint8Array;
      const n = Math.min(head.length, out.length - filled);
      out.set(head.subarray(0, n), filled);
      filled += n;
      if (n === head.length) client.queue.shift();
      else client.queue[0] = head.subarray(n);
    }
    client.queued -= out.length;
    return out;
  }

  // -- life -------------------------------------------------------------------

  private onExit(id: string, exitCode: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.exitCode !== null) return;
    entry.exitCode = exitCode;
    this.log(`terminal ${id} encerrado (código ${exitCode})`);
    entry.afterExit?.();
    // The pending output goes first, then the end.
    if (this.flush(entry)) this.scheduleFlush();
    if (entry.closing) this.remove(entry);
    else this.startIdle(entry);
  }

  private remove(entry: Entry): void {
    this.clearIdle(entry);
    this.entries.delete(entry.id);
  }

  private startIdle(entry: Entry): void {
    this.clearIdle(entry);
    const ms = (this.opts.idleMinutes ?? DEFAULT_IDLE_MINUTES) * 60_000;
    entry.idle = this.timers.set(() => {
      entry.idle = null;
      this.onIdle(entry);
    }, ms);
  }

  private clearIdle(entry: Entry): void {
    if (entry.idle !== null) this.timers.clear(entry.idle);
    entry.idle = null;
  }

  /** Nobody attached for the whole time, or the end was long ago. */
  private onIdle(entry: Entry): void {
    if (entry.exitCode !== null) {
      this.remove(entry);
      return;
    }
    this.log(`terminal ${entry.id} ocioso: encerrado`);
    entry.closing = true;
    entry.pty.kill();
  }
}
