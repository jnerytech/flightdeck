/**
 * Issue #939: a hidden or minimized window's page may be throttled, and frozen, by its webview.
 * Chromium does not freeze a page that holds a Web Lock (Tauri's own advice where its
 * `backgroundThrottling` setting is unsupported, Windows included), so the app holds one for its
 * whole life: the hosts' links keep answering their heartbeats while the window is away.
 */
export interface Locks {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

/** Takes the lock and never lets it go; false where the webview has no Web Locks. */
export function holdAwake(locks: Locks | undefined): boolean {
  if (!locks) return false;
  // The callback's promise never settles, so the lock is held until the page goes away.
  locks.request("flightdeck-awake", () => new Promise<never>(() => {})).catch(() => {});
  return true;
}
