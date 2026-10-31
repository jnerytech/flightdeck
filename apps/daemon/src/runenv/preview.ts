/** Whether the address answers: the real probe asks it over HTTP. */
export type ReadyProbe = (url: string) => Promise<boolean>;

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

export type ReadyResult = "ready" | "timeout" | "stopped";

export interface WaitOptions {
  probe: ReadyProbe;
  timeoutMs: number;
  intervalMs: number;
  /** Between two probes; real time when absent. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds now; `Date.now` when absent. */
  now?: () => number;
  /** The run was stopped: stop waiting. */
  stopped?: () => boolean;
}

/** Probes `url` until it answers, the time is up or the run is stopped. */
export async function waitReady(url: string, options: WaitOptions): Promise<ReadyResult> {
  const sleep = options.sleep ?? Bun.sleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    if (options.stopped?.()) return "stopped";
    if (await options.probe(url)) return "ready";
    if (now() >= deadline) return "timeout";
    await sleep(options.intervalMs);
  }
}

/** How long a process gets to answer before the preview gives up on it. */
export const READY_TIMEOUT_MS = 60_000;
export const READY_INTERVAL_MS = 500;

/** The real wait: HTTP probes every half second, for a minute. */
export function waitForServer(url: string, stopped: () => boolean): Promise<ReadyResult> {
  return waitReady(url, {
    probe: httpReady,
    timeoutMs: READY_TIMEOUT_MS,
    intervalMs: READY_INTERVAL_MS,
    stopped,
  });
}
