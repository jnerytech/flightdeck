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
  const waitMs = options.waitMs ?? 8000;
  const pollMs = options.pollMs ?? 250;
  const waitFor = async () => {
    const deadline = probe.now() + waitMs;
    for (;;) {
      if (await probe.online()) return true;
      if (probe.now() >= deadline) return false;
      await probe.sleep(pollMs);
    }
  };
  if (await waitFor()) return "online";
  await probe.reload();
  return (await waitFor()) ? "reloaded" : "gave-up";
}
