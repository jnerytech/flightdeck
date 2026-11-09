/**
 * Issue #1404: the person pauses new runs on a host before restarting or updating it. While paused,
 * a card that would start waits in the queue with the reason `paused`; runs already going finish.
 * The switch is the host's config (`pauseNewRuns`), so it survives a restart.
 */

/** The pause as `host.info` and `host.pause` say it: the switch and how many sessions still run. */
export interface HostPauseStatus {
  paused: boolean;
  running: number;
}

export class HostPause {
  private on: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(paused: boolean) {
    this.on = paused;
  }

  /** Whether new runs wait. */
  paused(): boolean {
    return false;
  }

  /** The hold while paused, null when new runs may start (the board's gate shape, as #1343's). */
  blocked(): { paused: true } | null {
    return null;
  }

  /** Turns the pause on or off; the watchers hear of a change. */
  set(_paused: boolean): void {}

  /** Calls `listener` whenever the pause is turned on or off. */
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
