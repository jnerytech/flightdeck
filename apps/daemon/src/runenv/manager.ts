import type { Database } from "bun:sqlite";
import { FlightdeckError } from "../errors.ts";
import type { RunConfig, RunConfigs } from "./config.ts";
import { type CardPorts, interpolatePorts, type PortMap, portEnv } from "./ports.ts";
import { type ReadyResult, waitForServer } from "./preview.ts";

/** One process of the card's run, as the UI shows it: a tab (terminal) with a state. */
export interface RunProcessState {
  name: string;
  terminalId: string;
  status: "running" | "exited";
  exitCode: number | null;
  /** The address the process serves, when the run.yaml gives a `ready.http`. */
  url: string | null;
  /** The preview: `none` without a `ready.http` (or after the process ended). */
  ready: "none" | "waiting" | "ready" | "timeout";
}

export interface RunState {
  cardId: string;
  status: "idle" | "setup" | "running" | "ended" | "failed";
  /** The preparation: `pending` until it ran (or when there is none), `done` after it. */
  setup: "pending" | "running" | "done" | "failed";
  /** The tab of the setup, while it is there. */
  setupTerminalId: string | null;
  ports: PortMap;
  processes: RunProcessState[];
  /** Why the run failed (the setup's exit code, a refusal), `null` otherwise. */
  error: string | null;
}

/** What the manager asks of the system to run something. The real one opens a terminal. */
export interface RunHost {
  /** Starts the process in a tab; `exited` settles with its exit code. */
  spawn(request: { argv: string[]; cwd: string; env: Record<string, string> }): {
    terminalId: string;
    exited: Promise<number>;
  };
  /** Ends the process and its whole tree. */
  kill(terminalId: string): void;
}

export interface RunManagerOptions {
  /** Remembers the cards whose setup ran. */
  db: Database;
  configs: Pick<RunConfigs, "resolve">;
  ports: Pick<CardPorts, "reserve">;
  host: RunHost;
  /** The card and its project, as the board has them. */
  card(cardId: string): { id: string; projectId: string; worktreePath: string | null };
  project(projectId: string): { id: string; path: string; baseBranch: string };
  /** Waits for a process's `ready.http` to answer; the real HTTP wait when absent. */
  waitReady?: (url: string, stopped: () => boolean) => Promise<ReadyResult>;
}

interface ProcessEntry extends RunProcessState {
  exited: Promise<number>;
}

/** What the manager keeps of a card's run. */
interface Entry {
  cardId: string;
  projectId: string;
  status: RunState["status"];
  setup: RunState["setup"];
  setupTerminalId: string | null;
  setupExited: Promise<number> | null;
  ports: PortMap;
  processes: ProcessEntry[];
  error: string | null;
  /** Stop was asked: whatever is still being started must not go on. */
  stopped: boolean;
}

/** The system refused to open a process (the terminal is off, the limit is reached). */
class StartError extends Error {
  constructor(
    readonly what: string,
    reason: string,
  ) {
    super(reason);
  }
}

const LIVE: ReadonlySet<RunState["status"]> = new Set(["setup", "running"]);

/** The processes of the cards' run environments: setup once, then each one in its own tab. */
export class RunManager {
  private readonly entries = new Map<string, Entry>();
  private readonly watchers = new Set<(state: RunState) => void>();

  constructor(private readonly opts: RunManagerOptions) {}

  /**
   * Starts the card's run: the setup if it did not run yet, then each process of the run.yaml.
   * Answers once everything is validated and the first process (the setup, or the run) has been
   * started; the rest goes on in the background and shows in `state` and `watch`.
   */
  async start(cardId: string): Promise<RunState> {
    const card = this.opts.card(cardId);
    if (!card.worktreePath) throw new FlightdeckError("invalid_state", "card ainda sem worktree");
    const current = this.entries.get(cardId);
    if (current && LIVE.has(current.status)) return this.snapshot(current);
    // Nothing the run.yaml declares runs before its hash is trusted.
    const config = await this.opts.configs.resolve(this.opts.project(card.projectId));
    if (config.exclusive && this.otherLive(card.projectId, cardId)) {
      throw new FlightdeckError(
        "invalid_state",
        "outro card está rodando neste projeto (modo não concorrente)",
      );
    }
    const ports = await this.opts.ports.reserve(cardId, config.ports);
    const entry: Entry = {
      cardId,
      projectId: card.projectId,
      status: "setup",
      setup: this.setupDone(cardId) ? "done" : "pending",
      setupTerminalId: null,
      setupExited: null,
      ports,
      processes: [],
      error: null,
      stopped: false,
    };
    this.entries.set(cardId, entry);
    void this.execute(entry, config, card.worktreePath);
    return this.snapshot(entry);
  }

  /** Ends the setup or the processes of the card, and everything they started. */
  async stop(cardId: string): Promise<RunState> {
    const entry = this.entries.get(cardId);
    if (!entry || !LIVE.has(entry.status)) return this.state(cardId);
    entry.stopped = true;
    const exits: Promise<number>[] = [];
    if (entry.setup === "running" && entry.setupTerminalId && entry.setupExited) {
      this.opts.host.kill(entry.setupTerminalId);
      exits.push(entry.setupExited);
      entry.setup = "pending";
    }
    for (const process of entry.processes) {
      if (process.status !== "running") continue;
      this.opts.host.kill(process.terminalId);
      exits.push(process.exited);
    }
    await Promise.all(exits);
    entry.status = "ended";
    this.emit(entry);
    return this.snapshot(entry);
  }

  state(cardId: string): RunState {
    const entry = this.entries.get(cardId);
    if (entry) return this.snapshot(entry);
    return {
      cardId,
      status: "idle",
      setup: this.setupDone(cardId) ? "done" : "pending",
      setupTerminalId: null,
      ports: {},
      processes: [],
      error: null,
    };
  }

  /** Calls `listener` with the card's state at every change. */
  watch(listener: (state: RunState) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  /** The card is done: its processes end. */
  follow(
    watch: (listener: (card: { id: string; column: string }) => void) => () => void,
  ): () => void {
    return watch((card) => {
      if (card.column === "done") void this.stop(card.id);
    });
  }

  private async execute(entry: Entry, config: RunConfig, cwd: string): Promise<void> {
    const env = portEnv(entry.ports);
    const spawn = (what: string, argv: string[], extra: Record<string, string> = {}) => {
      try {
        return this.opts.host.spawn({
          argv: argv.map((part) => interpolatePorts(part, entry.ports)),
          cwd,
          env: { ...env, ...extra },
        });
      } catch (error) {
        throw new StartError(what, (error as Error).message);
      }
    };
    try {
      if (config.setup && entry.setup !== "done") {
        await this.runSetup(entry, spawn("o setup", config.setup));
        if (entry.status !== "setup") return;
      }
      entry.status = "running";
      for (const proc of config.run) {
        const extra = Object.fromEntries(
          Object.entries(proc.env).map(([key, value]) => [
            key,
            interpolatePorts(value, entry.ports),
          ]),
        );
        const url = proc.ready ? interpolatePorts(proc.ready.http, entry.ports) : null;
        this.track(entry, proc.name, spawn(proc.name, proc.cmd, extra), url);
      }
      this.emit(entry);
    } catch (error) {
      await this.fail(entry, error as StartError);
    }
  }

  /** The setup runs to its end; `entry.status` stays `setup` only when it worked. */
  private async runSetup(entry: Entry, setup: { terminalId: string; exited: Promise<number> }) {
    entry.setup = "running";
    entry.setupTerminalId = setup.terminalId;
    entry.setupExited = setup.exited;
    this.emit(entry);
    const code = await setup.exited;
    if (entry.stopped) {
      entry.status = "ended";
      return;
    }
    if (code !== 0) {
      entry.setup = "failed";
      entry.status = "failed";
      entry.error = `o setup falhou (código ${code})`;
      this.emit(entry);
      return;
    }
    this.markSetupDone(entry.cardId);
    entry.setup = "done";
  }

  private track(
    entry: Entry,
    name: string,
    started: ReturnType<RunHost["spawn"]>,
    url: string | null,
  ): void {
    const process: ProcessEntry = {
      name,
      terminalId: started.terminalId,
      status: "running",
      exitCode: null,
      url,
      ready: url ? "waiting" : "none",
      exited: started.exited,
    };
    entry.processes.push(process);
    if (url) {
      const wait = this.opts.waitReady ?? waitForServer;
      void wait(url, () => entry.stopped || process.status === "exited").then((result) => {
        if (result === "stopped" || process.status !== "running") return;
        process.ready = result;
        this.emit(entry);
      });
    }
    void started.exited.then((code) => {
      process.status = "exited";
      process.exitCode = code;
      process.ready = "none";
      if (!entry.stopped && entry.processes.every((p) => p.status === "exited")) {
        entry.status = "ended";
      }
      this.emit(entry);
    });
  }

  /** A start the system refused: what already runs ends, and the reason is shown. */
  private async fail(entry: Entry, error: StartError): Promise<void> {
    entry.stopped = true;
    const running = entry.processes.filter((p) => p.status === "running");
    for (const process of running) this.opts.host.kill(process.terminalId);
    await Promise.all(running.map((p) => p.exited));
    if (entry.setup === "running" || entry.status === "setup") entry.setup = "failed";
    entry.status = "failed";
    entry.error = `não consegui iniciar ${error.what}: ${error.message}`;
    this.emit(entry);
  }

  private otherLive(projectId: string, cardId: string): boolean {
    return [...this.entries.values()].some(
      (e) => e.projectId === projectId && e.cardId !== cardId && LIVE.has(e.status),
    );
  }

  private setupDone(cardId: string): boolean {
    return (
      this.opts.db.query("SELECT 1 FROM card_setup_done WHERE card_id = ?").get(cardId) !== null
    );
  }

  private markSetupDone(cardId: string): void {
    this.opts.db
      .query("INSERT OR IGNORE INTO card_setup_done (card_id, done_at) VALUES (?, ?)")
      .run(cardId, new Date().toISOString());
  }

  private snapshot(entry: Entry): RunState {
    return {
      cardId: entry.cardId,
      status: entry.status,
      setup: entry.setup,
      setupTerminalId: entry.setupTerminalId,
      ports: { ...entry.ports },
      processes: entry.processes.map(({ name, terminalId, status, exitCode, url, ready }) => ({
        name,
        terminalId,
        status,
        exitCode,
        url,
        ready,
      })),
      error: entry.error,
    };
  }

  private emit(entry: Entry): void {
    const state = this.snapshot(entry);
    for (const watcher of this.watchers) watcher(state);
  }
}
