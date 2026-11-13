import type { LogLevel } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppUpdate, Platform } from "../../platform/types.ts";

/** What the app knows about its own update. */
export interface AppUpdateState {
  /** A newer version on offer (hidden again by "Depois"). */
  offer: AppUpdate | null;
  /** The last check found nothing newer. */
  upToDate: boolean;
  /** Why the last check or install failed. */
  error: string | null;
  /** Issue #280: the version downloaded in the background, ready to install on a restart. */
  ready: string | null;
}

export function initialAppUpdateState(): AppUpdateState {
  return { offer: null, upToDate: false, error: null, ready: null };
}

/** How often the app looks for its own update while open. */
const APP_UPDATE_INTERVAL_MS = 6 * 3_600_000;

/** What the app's update reads and does through the app's store. */
export interface AppUpdateCore {
  /** The platform's updater (the Tauri one in the desktop app, signed `latest.json`). */
  updater(): Platform["updater"];
  state(): AppUpdateState;
  setState(next: AppUpdateState): void;
  /** The two switches of the settings that ask for a check. */
  switches(): { notifyUpdates: boolean; autoUpdate: boolean };
  /** How often to check, when a test changes it. */
  intervalMs(): number | undefined;
  log(level: LogLevel, source: string, message: string): void;
  /** Asks the shell to exit. */
  quitNow(): Promise<void>;
  t(): T;
}

/**
 * The app's own update (phase 9, #1596: a slice of the store): the check, a download in the
 * background, the install with a restart and the one that goes with the tray's Quit. What it
 * installs is only what the updater verified against the signed `latest.json`.
 */
export class AppUpdateSlice {
  private timer: ReturnType<typeof setInterval> | null = null;
  private quitting = false;

  constructor(private readonly core: AppUpdateCore) {}

  /** Checks now and then every few hours, while a switch of the settings asks for it. */
  start(): void {
    const { notifyUpdates, autoUpdate } = this.core.switches();
    if (!this.core.updater().supported || !(notifyUpdates || autoUpdate)) return;
    void this.check();
    this.timer = setInterval(() => {
      const { notifyUpdates, autoUpdate } = this.core.switches();
      if (notifyUpdates || autoUpdate) void this.check();
    }, this.core.intervalMs() ?? APP_UPDATE_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Asks the updater for a newer app version. */
  async check(): Promise<void> {
    try {
      const offer = await this.core.updater().check();
      this.core.log(
        "info",
        "update",
        offer === null ? "up to date" : `version ${offer.version} is available`,
      );
      this.patch({ offer, upToDate: offer === null, error: null });
      if (offer && this.core.switches().autoUpdate) await this.download(offer.version);
    } catch (error) {
      this.core.log(
        "error",
        "update",
        `the check failed: ${(error as Error).message ?? String(error)}`,
      );
      this.patch({
        upToDate: false,
        error: this.core.t()("messages.updateCheckFailed", {
          error: (error as Error).message ?? String(error),
        }),
      });
    }
  }

  /** Installs the offered version; the app restarts. A failure installs nothing and says why. */
  async install(): Promise<void> {
    try {
      await this.core.updater().install();
    } catch (error) {
      this.patch({
        error: this.core.t()("messages.updateInstallFailed", {
          error: (error as Error).message ?? String(error),
        }),
      });
    }
  }

  /**
   * Issue #402: the tray's Quit. A version downloaded in the background installs on the way out
   * (no restart), so the next start is on it; then the app asks the shell to exit, also when the
   * install failed.
   */
  async quit(): Promise<void> {
    // A second Quit while the first installs waits for it: the same bytes are never installed twice.
    if (this.quitting) return;
    this.quitting = true;
    try {
      if (this.core.state().ready) await this.core.updater().installDownloaded();
    } catch {
      // Quitting wins: the update is offered again at the next start.
    } finally {
      await this.core.quitNow();
    }
  }

  /** "Depois": the banner goes until the next check. */
  dismiss(): void {
    this.patch({ offer: null });
  }

  /**
   * Issue #280: downloads the version on offer in the background, once; the banner then offers to
   * restart into it. A failure says why and is tried again at the next check.
   */
  private async download(version: string): Promise<void> {
    if (this.core.state().ready === version) return;
    try {
      await this.core.updater().download();
      this.patch({ ready: version });
    } catch (error) {
      this.patch({
        error: this.core.t()("messages.updateDownloadFailed", {
          error: (error as Error).message ?? String(error),
        }),
      });
    }
  }

  private patch(patch: Partial<AppUpdateState>): void {
    this.core.setState({ ...this.core.state(), ...patch });
  }
}
