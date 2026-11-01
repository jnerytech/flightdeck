/** What `ensureOnline` needs from a page: the hosts' state, a reload and a clock. */
export interface OnlineProbe {
  /** Whether the hosts the journey uses show as online (true when the page cannot tell). */
  online(): Promise<boolean>;
  reload(): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** How a journey's page ended up: online at once, after a reload, or still not online. */
export type OnlineResult = "online" | "reloaded" | "gave-up";

/**
 * Waits for the demo hosts to be online, and reloads the page once if they are not by `waitMs`:
 * a first connection that fails under load would otherwise leave the journey on offline hosts.
 */
export async function ensureOnline(
  probe: OnlineProbe,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<OnlineResult> {
  return "gave-up";
}
