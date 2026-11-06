/**
 * Issue #280 (part 2): the daemon applies the update its manifest check found by itself, but only
 * while the host is idle (no session starting, running or waiting for a permission, no workflow run),
 * and only when the person left `updates.auto` on. Applying is `DaemonUpdater.apply`, so the sha256 and
 * the minisign signature are checked as ever; this class only decides when to start it.
 */
import type { AutoUpdateStatus, DaemonManifest } from "@flightdeck/protocol";
import { type Config, updateConfigFile } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import { realTimers, type Timers } from "../quota/quota.ts";
import { compareVersions } from "../update.ts";

export interface AutoUpdaterOptions {
  enabled(): boolean;
  /** This daemon's version. */
  currentVersion: string;
  /** The manifest of the last successful check. */
  latest(): DaemonManifest | null;
  /** Whether nothing runs on the host right now. */
  idle(): boolean;
  /**
   * `DaemonUpdater.apply` with the confirmation the setting stands for. `proceed` is asked once the
   * binary is downloaded and verified, right before it is started: false when the host got busy.
   */
  apply(proceed: () => boolean): Promise<unknown>;
  /** How long a waiting update waits before it looks at the host again. */
  retryMs?: number;
  now?: () => number;
  timers?: Timers;
  log?: (line: string) => void;
}

export class AutoUpdater {
  private applying = false;
  private started: { version: string; at: string } | null = null;
  private failed: { version: string; reason: string; at: string } | null = null;
  private timer: unknown = null;
  private readonly timers: Timers;

  constructor(private readonly opts: AutoUpdaterOptions) {
    this.timers = opts.timers ?? realTimers;
  }

  status(): AutoUpdateStatus {
    if (!this.opts.enabled()) return { enabled: false, state: "off" };
    const version = this.newer()?.version;
    if (!version) return { enabled: true, state: "current" };
    if (this.started?.version === version)
      return { enabled: true, state: "started", ...this.started };
    if (this.failed?.version === version) return { enabled: true, state: "failed", ...this.failed };
    return { enabled: true, state: "waiting", version };
  }

  /** A manifest check ended: a failed apply may be tried again, and the host is looked at. */
  async checked(): Promise<void> {
    this.failed = null;
    await this.tick();
  }

  /** Looks at the host now: applies the update if there is one and the host is idle. */
  async tick(): Promise<void> {
    this.stop();
    if (!this.opts.enabled() || this.applying) return;
    const version = this.newer()?.version;
    if (!version || this.started?.version === version || this.failed?.version === version) return;
    if (!this.opts.idle()) {
      this.timer = this.timers.set(() => void this.tick(), this.opts.retryMs ?? 60_000);
      return;
    }
    this.applying = true;
    const at = new Date((this.opts.now ?? Date.now)()).toISOString();
    try {
      await this.opts.apply(() => this.opts.idle());
      this.started = { version, at };
      this.opts.log?.(`auto update: ${version} is being applied (the host is idle)`);
    } catch (error) {
      const reason = error instanceof FlightdeckError ? error.reason : undefined;
      if (reason === "update_host_busy") {
        // A session started while the binary downloaded: nothing was started, look again later.
        this.opts.log?.(`auto update: ${version} waits, the host got busy while it downloaded`);
        this.timer = this.timers.set(() => void this.tick(), this.opts.retryMs ?? 60_000);
      } else {
        // The status goes to every client: a code; the message (it may name a path) goes to the log.
        this.failed = { version, reason: reason ?? "update_failed", at };
        this.opts.log?.(
          `auto update: ${version} failed, the current version stays: ${(error as Error).message}`,
        );
      }
    } finally {
      this.applying = false;
    }
  }

  stop(): void {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** The manifest of the last check, when it is newer than this daemon: never the same version or an older one. */
  private newer(): DaemonManifest | null {
    const latest = this.opts.latest();
    return latest && compareVersions(latest.version, this.opts.currentVersion) > 0 ? latest : null;
  }
}

/** `host.info.autoUpdate` and `host.updates.set` for the server: the setting is kept in the config file and in the running config. */
export function autoUpdateOf(auto: AutoUpdater, config: Config, configFile: string) {
  return {
    status: auto.status.bind(auto),
    set: async (on: boolean): Promise<AutoUpdateStatus> => {
      // The file first: a write that fails leaves the running setting as the file has it.
      await updateConfigFile(configFile, (raw) => ({
        ...raw,
        updates: { ...(raw.updates as object | undefined), auto: on },
      }));
      config.updates.auto = on;
      await auto.tick();
      return auto.status();
    },
  };
}
