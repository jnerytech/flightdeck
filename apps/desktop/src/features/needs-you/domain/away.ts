/**
 * Issue #1344: "While you were away". The app writes the time it was last active; the next start
 * reads it before it writes again, so the summary can say what happened since the app was closed.
 */
export const AWAY_KEY = "flightdeck.lastActive";
/** An absence shorter than this is not worth a summary. */
export const AWAY_MIN_MS = 30 * 60_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export class AwayClock {
  /** The last time the app was active before this start, as an ISO time, or null. */
  readonly previous: string | null;

  constructor(
    private readonly storage: Storage,
    private readonly now: () => number,
  ) {
    this.previous = this.read();
  }

  private read(): string | null {
    try {
      const raw = this.storage.getItem(AWAY_KEY);
      return raw !== null && Number.isFinite(Date.parse(raw)) ? raw : null;
    } catch {
      return null;
    }
  }

  /** Writes now as the last time the app was active. */
  mark(): void {
    try {
      this.storage.setItem(AWAY_KEY, new Date(this.now()).toISOString());
    } catch {
      // A storage that cannot be written only costs the next start its summary.
    }
  }

  /** The time to ask about when the app was away long enough, else null. */
  since(): string | null {
    if (this.previous === null) return null;
    return this.now() - Date.parse(this.previous) >= AWAY_MIN_MS ? this.previous : null;
  }
}
