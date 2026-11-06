/**
 * Issue #280 (part 2): the daemon applies the update its manifest check found by itself, but only
 * while the host is idle (no session starting, running or waiting for a permission, no workflow run),
 * and only when the person left `updates.auto` on. Applying is `DaemonUpdater.apply`, so the sha256 and
 * the minisign signature are checked as ever; this class only decides when to start it.
 */
import type { DaemonManifest } from "@flightdeck/protocol";
import type { Timers } from "../quota/quota.ts";

/** What the host page shows about the automatic update. */
export interface AutoUpdateStatus {
  enabled: boolean;
  /** `off`, `current` (nothing newer), `waiting` (busy), `started` (the update runs) or `failed`. */
  state: "off" | "current" | "waiting" | "started" | "failed";
  version?: string;
  reason?: string;
  at?: string;
}

export interface AutoUpdaterOptions {
  enabled(): boolean;
  /** This daemon's version. */
  currentVersion: string;
  /** The manifest of the last successful check. */
  latest(): DaemonManifest | null;
  /** Whether nothing runs on the host right now. */
  idle(): boolean;
  /** `DaemonUpdater.apply` with the confirmation the setting stands for. */
  apply(): Promise<unknown>;
  /** How long a waiting update waits before it looks at the host again. */
  retryMs?: number;
  now?: () => number;
  timers?: Timers;
  log?: (line: string) => void;
}

export class AutoUpdater {
  constructor(private readonly opts: AutoUpdaterOptions) {}

  status(): AutoUpdateStatus {
    return { enabled: false, state: "off" };
  }

  /** A manifest check ended: a failed apply may be tried again, and the host is looked at. */
  async checked(): Promise<void> {}

  /** Looks at the host now: applies the update if there is one and the host is idle. */
  async tick(): Promise<void> {}

  stop(): void {}
}
