/**
 * The preview's wait for a run's server (issue #1601: the rule is pure). The probe, the sleep and
 * the clock come in from the caller; runenv/preview.ts passes the real ones.
 */

/** Whether the address answers: the real probe asks it over HTTP. */
export type ReadyProbe = (url: string) => Promise<boolean>;

export type ReadyResult = "ready" | "timeout" | "stopped";

export interface WaitOptions {
  probe: ReadyProbe;
  timeoutMs: number;
  intervalMs: number;
  /** Between two probes. */
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds now. */
  now: () => number;
  /** The run was stopped: stop waiting. */
  stopped?: () => boolean;
}

/** Probes `url` until it answers, the time is up or the run is stopped. */
export async function waitReady(url: string, options: WaitOptions): Promise<ReadyResult> {
  const { sleep, now } = options;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    if (options.stopped?.()) return "stopped";
    if (await options.probe(url)) return "ready"; // NOSONAR: sequential by design: each pass needs the answer of the one before
    if (now() >= deadline) return "timeout";
    await sleep(options.intervalMs); // NOSONAR: poll interval: the wait between looks is the point of this loop
  }
}

/** How long a process gets to answer before the preview gives up on it. */
export const READY_TIMEOUT_MS = 60_000;
export const READY_INTERVAL_MS = 500;
