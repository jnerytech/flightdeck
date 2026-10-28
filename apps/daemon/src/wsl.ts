import { closeSync, mkdirSync, openSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import type { Subprocess } from "bun";

/** One WSL distro whose daemon the Windows daemon keeps running (config section `wsl`). */
export interface WslItem {
  distro: string;
  command: string;
  port: number;
}

/** Exit code of a daemon that found another one already running on its dataDir. */
const EXIT_ALREADY_RUNNING = 3;

export interface WslSupervisorOptions {
  logDir: string;
  /** Command line for an item; defaults to `wslCommand`. Tests swap in a fake. */
  command?: (item: WslItem) => string[];
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Pause before checking again a daemon that was already running. */
  healthCheckMs?: number;
  portAlive?: (port: number) => Promise<boolean>;
  onRestart?: (item: WslItem, delayMs: number) => void;
  onHealthy?: (item: WslItem) => void;
}

/** `wsl.exe -d <distro> --exec bash -lc "<command>"`: a login shell, so ~/.profile applies. */
export function wslCommand(item: WslItem): string[] {
  return ["wsl.exe", "-d", item.distro, "--exec", "bash", "-lc", item.command];
}

/** True when something accepts TCP connections on 127.0.0.1:`port`. */
export function tcpAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

interface Slot {
  item: WslItem;
  child: Subprocess | null;
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
}

/**
 * Keeps one child per WSL item alive: logs to `logDir/wsl-<distro>.log`, restarts with
 * exponential backoff (1 s up to 60 s) and kills every child on `stop`. The running child also
 * keeps the distro awake.
 */
export class WslSupervisor {
  private readonly slots: Slot[];
  private stopping = false;

  constructor(
    items: WslItem[],
    private readonly opts: WslSupervisorOptions,
  ) {
    this.slots = items.map((item) => ({ item, child: null, timer: null, attempt: 0 }));
  }

  start(): void {
    mkdirSync(this.opts.logDir, { recursive: true });
    for (const slot of this.slots) this.spawn(slot);
  }

  pids(): number[] {
    return this.slots.flatMap((s) => (s.child ? [s.child.pid] : []));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const exits: Promise<unknown>[] = [];
    for (const slot of this.slots) {
      if (slot.timer) clearTimeout(slot.timer);
      if (slot.child) {
        slot.child.kill();
        exits.push(slot.child.exited);
      }
    }
    await Promise.all(exits);
  }

  private spawn(slot: Slot): void {
    slot.timer = null;
    const log = openSync(join(this.opts.logDir, `wsl-${slot.item.distro}.log`), "a");
    const child = Bun.spawn((this.opts.command ?? wslCommand)(slot.item), {
      stdin: "ignore",
      stdout: log,
      stderr: log,
    });
    slot.child = child;
    void child.exited.then(async (code) => {
      closeSync(log);
      slot.child = null;
      if (this.stopping) return;
      const portAlive = this.opts.portAlive ?? tcpAlive;
      if (code === EXIT_ALREADY_RUNNING && (await portAlive(slot.item.port))) {
        slot.attempt = 0;
        this.opts.onHealthy?.(slot.item);
        this.schedule(slot, this.opts.healthCheckMs ?? 60_000);
        return;
      }
      const base = this.opts.baseDelayMs ?? 1000;
      const delay = Math.min(this.opts.maxDelayMs ?? 60_000, base * 2 ** slot.attempt++);
      this.opts.onRestart?.(slot.item, delay);
      this.schedule(slot, delay);
    });
  }

  private schedule(slot: Slot, delayMs: number): void {
    if (this.stopping) return;
    slot.timer = setTimeout(() => this.spawn(slot), delayMs);
  }
}
