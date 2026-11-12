/**
 * Issue #939: a hidden or minimized window's page may be frozen by its Chromium webview (WebView2
 * on Windows), which stops it answering the hosts' heartbeats. Chromium does not freeze a page that
 * holds a Web Lock; Tauri gives the same advice where its `backgroundThrottling` setting is
 * unsupported, Windows included. It does not stop timer throttling, and WKWebView and WebKitGTK
 * have their own policies: the real check is a Windows window minimized 10 minutes (#14).
 */
export interface Locks {
  request(
    name: string,
    options: { mode: "shared" },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Takes the lock and never lets it go; false where the webview has none, or refuses at once. The
 * lock is shared, so a second page of the app (a reload racing the old one) holds its own grant.
 * A refusal goes to `onError` (the app log), never out of here: the app mounts either way.
 */
export function holdAwake(locks: Locks | undefined, onError: (error: unknown) => void): boolean {
  if (!locks) return false;
  try /* NOSONAR: request() can throw synchronously; .catch covers only its rejection */ {
    // The callback's promise never settles, so the lock is held until the page goes away.
    locks
      .request("flightdeck-awake", { mode: "shared" }, () => new Promise<never>(() => {}))
      .catch(onError);
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
