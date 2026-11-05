/** Keeps the computer awake while sessions run (issue #163). */

import { whichOnPath } from "../which.ts";
import { detectWsl, realWslProbe } from "../wsl-host.ts";

export type WakeMethod = "powershell" | "systemd-inhibit" | "caffeinate";
/** Why nothing is held although it was asked: the app words each code in both languages. */
export type WakeReason = "no-inhibitor" | "unsupported-platform" | "wsl" | "start-failed" | "ended";

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
  /** The daemon runs inside WSL: an inhibitor there does not keep Windows awake. */
  wsl: boolean;
  which(name: string): string | null;
  /** Starts the holder; null when it cannot start. */
  hold(cmd: string[]): Holder | null;
}

/**
 * The PowerShell that holds the system awake: ES_CONTINUOUS | ES_SYSTEM_REQUIRED (0x80000001) stays
 * set for as long as this process lives, and it ends when the daemon does. The screen may still turn
 * off. The flags are written as the decimal 2147483649: `0x80000001` is a negative Int32 in
 * PowerShell and does not convert to the uint parameter. Any error stops the script, so a holder
 * that holds nothing ends (the page then says so) instead of looping for nothing.
 */
export const windowsScript = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a pid: ${pid}`);
  return [
    "$ErrorActionPreference = 'Stop';",
    "Add-Type -Namespace Fd -Name Power -MemberDefinition",
    "\"[DllImport('kernel32.dll')] public static extern uint SetThreadExecutionState(uint flags);\";",
    "[void][Fd.Power]::SetThreadExecutionState(2147483649);",
    `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`,
  ].join(" ");
};

/** The command that holds the computer awake on this system, or why there is none. */
export function holderCommand(
  ctx: Pick<PowerContext, "platform" | "pid" | "which"> & { wsl?: boolean },
): { cmd: string[]; method: WakeMethod } | { reason: WakeReason } {
  if (ctx.platform === "linux") {
    // Inside WSL an inhibitor holds the WSL machine only: Windows would still sleep.
    if (ctx.wsl) return { reason: "wsl" };
    const inhibit = ctx.which("systemd-inhibit");
    // tail --pid is GNU: found like the inhibitor, so a minimal system gives a reason, not an early exit.
    const tail = ctx.which("tail");
    if (!inhibit || !tail) return { reason: "no-inhibitor" };
    return {
      method: "systemd-inhibit",
      cmd: [
        inhibit,
        "--what=idle:sleep",
        "--who=Flightdeck",
        "--why=Sessions are running",
        "--mode=block",
        tail,
        `--pid=${ctx.pid}`,
        "-f",
        "/dev/null",
      ],
    };
  }
  if (ctx.platform === "darwin") {
    const caffeinate = ctx.which("caffeinate");
    if (!caffeinate) return { reason: "no-inhibitor" };
    return { method: "caffeinate", cmd: [caffeinate, "-i", "-w", String(ctx.pid)] };
  }
  if (ctx.platform === "win32") {
    const shell = ctx.which("pwsh") ?? ctx.which("powershell");
    if (!shell) return { reason: "no-inhibitor" };
    return {
      method: "powershell",
      cmd: [
        shell,
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        // Base64 of UTF-16LE: the quotes of the script do not depend on Windows argv quoting.
        Buffer.from(windowsScript(ctx.pid), "utf16le").toString("base64"),
      ],
    };
  }
  return { reason: "unsupported-platform" };
}

/**
 * Holds the computer awake while at least one session runs or waits for a permission, if the
 * setting is on. One holder for any number of sessions; a failure is a reason, never an error, and
 * is not retried until the sessions stop and begin again.
 */
export class KeepAwake {
  private active = 0;
  private holder: Holder | null = null;
  private method: WakeMethod | null = null;
  private reason: WakeReason | null = null;
  /** Something went wrong this round: wait for the sessions to stop before trying again. */
  private latched = false;
  private stopped = false;

  constructor(
    private readonly ctx: PowerContext,
    private enabled = true,
  ) {}

  /** The number of sessions running or waiting for a permission changed. */
  update(active: number): void {
    this.active = active;
    if (active === 0) this.latched = false;
    this.settle();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.latched = false;
    this.settle();
  }

  status(): WakeStatus {
    return {
      enabled: this.enabled,
      held: this.holder !== null,
      method: this.holder ? this.method : null,
      reason: this.reason,
    };
  }

  /** Releases whatever is held (the daemon is stopping). */
  stop(): void {
    this.stopped = true;
    this.release();
  }

  private settle(): void {
    const wanted = this.enabled && this.active > 0 && !this.stopped;
    if (!wanted) {
      this.release();
      this.reason = null;
      return;
    }
    if (this.holder || this.latched) return;
    this.acquire();
  }

  private acquire(): void {
    const found = holderCommand(this.ctx);
    if ("reason" in found) {
      this.reason = found.reason;
      this.latched = true;
      return;
    }
    let holder: Holder | null = null;
    try {
      holder = this.ctx.hold(found.cmd);
    } catch {
      holder = null;
    }
    if (!holder) {
      this.reason = "start-failed";
      this.latched = true;
      return;
    }
    this.holder = holder;
    this.method = found.method;
    this.reason = null;
    void holder.exited.then(() => {
      if (this.holder !== holder) return;
      this.holder = null;
      this.method = null;
      this.reason = "ended";
      this.latched = true;
    });
  }

  private release(): void {
    const holder = this.holder;
    this.holder = null;
    this.method = null;
    holder?.kill();
  }
}

/** A holder started as a child process of the daemon. */
export function spawnHolder(cmd: string[]): Holder | null {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
    return {
      kill: () => proc.kill(),
      exited: proc.exited.then(() => undefined),
    };
  } catch {
    return null;
  }
}

export function osPowerContext(): PowerContext {
  return {
    platform: process.platform,
    pid: process.pid,
    wsl: detectWsl(realWslProbe) !== null,
    which: whichOnPath,
    hold: spawnHolder,
  };
}
