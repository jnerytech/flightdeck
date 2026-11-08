/**
 * Phase 9: the daemon checks its release manifest (`daemon-latest.json`) at boot, on request and every
 * `checkIntervalH`, and `host.info` reports what it found. A failed check is only an error in
 * the status: the daemon keeps running.
 */
import { DaemonManifest, type UpdateStatus } from "@flightdeck/protocol";
import type { Timers } from "../quota/quota.ts";
import { compareVersions } from "../update.ts";

export type { UpdateStatus };

export interface UpdateCheckerOptions {
  manifestUrl: string;
  checkIntervalH: number;
  /** This daemon's version. */
  currentVersion: string;
  now?: () => number;
  timers?: Timers;
  fetch?: (url: string) => Promise<Response>;
  /** Called after every check, a failed one too (issue #280: the automatic update looks at the host then). */
  onChecked?: () => unknown;
}

export class UpdateChecker {
  private last: UpdateStatus | null = null;
  private manifest: DaemonManifest | null = null;
  private timer: unknown = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly fetch: (url: string) => Promise<Response>;

  constructor(private readonly opts: UpdateCheckerOptions) {
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.fetch = opts.fetch ?? ((url) => fetch(url));
  }

  /** Checks now and then on every interval. */
  async start(): Promise<void> {
    await this.check();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** The last check, `null` before the first one ends. */
  status(): UpdateStatus | null {
    return this.last;
  }

  /** The manifest of the last successful check (what `daemon.update.apply` applies). */
  latest(): DaemonManifest | null {
    return this.manifest;
  }

  /** Checks right now, whatever the interval says, and returns what was found. */
  async checkNow(): Promise<UpdateStatus> {
    await this.check();
    return this.last as UpdateStatus;
  }

  private async check(): Promise<void> {
    // One timer waits at a time: a check made on request moves the next one to a full interval.
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const manifest = await this.download();
      this.manifest = manifest;
      const available = compareVersions(manifest.version, this.opts.currentVersion) > 0;
      this.last = { available, version: manifest.version, checkedAt };
    } catch (error) {
      this.last = { available: false, version: null, checkedAt, error: (error as Error).message };
    }
    if (!this.stopped) {
      this.timer = this.timers.set(() => void this.check(), this.opts.checkIntervalH * 3_600_000);
    }
    // The automatic update looks at the host after a check; what it throws never stops the checks.
    await Promise.resolve(this.opts.onChecked?.()).catch(() => undefined);
  }

  private async download(): Promise<DaemonManifest> {
    let response: Response;
    try {
      response = await this.fetch(this.opts.manifestUrl);
    } catch (error) {
      throw new Error(`could not download the manifest: ${(error as Error).message}`);
    }
    if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
    const parsed = DaemonManifest.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error(`invalid manifest: ${parsed.error.message}`);
    return parsed.data;
  }
}
