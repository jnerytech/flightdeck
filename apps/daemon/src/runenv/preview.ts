import {
  READY_INTERVAL_MS,
  READY_TIMEOUT_MS,
  type ReadyResult,
  waitReady,
} from "./domain/preview.ts";

/** Any HTTP answer counts (a 404 is a server that is up); a refused connection or silence does not. */
export async function httpReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** The real wait: HTTP probes every half second, for a minute. */
export function waitForServer(url: string, stopped: () => boolean): Promise<ReadyResult> {
  return waitReady(url, {
    probe: httpReady,
    timeoutMs: READY_TIMEOUT_MS,
    intervalMs: READY_INTERVAL_MS,
    sleep: Bun.sleep,
    now: Date.now,
    stopped,
  });
}
