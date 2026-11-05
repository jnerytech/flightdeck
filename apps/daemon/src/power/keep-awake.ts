/** Keeps the computer awake while sessions run (issue #163). */
import { whichOnPath } from "../which.ts";

export type WakeMethod = "powershell" | "systemd-inhibit" | "caffeinate";
/** Why nothing is held although it was asked: the app words each code in both languages. */
export type WakeReason = "no-inhibitor" | "unsupported-platform" | "start-failed" | "ended";

export interface WakeStatus {
  /** The setting. */
  enabled: boolean;
  /** Whether the computer is being held awake right now. */
  held: boolean;
  method: WakeMethod | null;
  reason: WakeReason | null;
}

/** A program that holds the computer awake for as long as it runs. */
export interface Holder {
  kill(): void;
  /** Resolves when the program is gone, whoever ended it. */
  exited: Promise<void>;
}

export interface PowerContext {
  platform: NodeJS.Platform;
  /** The daemon's pid: the holder leaves when it does. */
  pid: number;
  which(name: string): string | null;
  /** Starts the holder; null when it cannot start. */
  hold(cmd: string[]): Holder | null;
}

/** The command that holds the computer awake on this system, or why there is none. */
export function holderCommand(
  _ctx: Pick<PowerContext, "platform" | "pid" | "which">,
): { cmd: string[]; method: WakeMethod } | { reason: WakeReason } {
  return { reason: "start-failed" };
}

export class KeepAwake {
  constructor(
    private readonly ctx: PowerContext,
    enabled = true,
  ) {
    void this.ctx;
    void enabled;
  }

  /** The number of sessions running or waiting for a permission changed. */
  update(_active: number): void {}

  setEnabled(_enabled: boolean): void {}

  status(): WakeStatus {
    return { enabled: false, held: true, method: null, reason: null };
  }

  /** Releases whatever is held (the daemon is stopping). */
  stop(): void {}
}

/** A holder started as a child process of the daemon. */
export function spawnHolder(_cmd: string[]): Holder | null {
  return null;
}

export function osPowerContext(): PowerContext {
  return {
    platform: process.platform,
    pid: process.pid,
    which: whichOnPath,
    hold: spawnHolder,
  };
}
