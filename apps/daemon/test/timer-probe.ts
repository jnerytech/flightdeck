/**
 * Records the timers the daemon's code starts and has not cleared (or fired, for a timeout).
 * Only those started from `apps/daemon/src` count, named by the file that started them, and
 * only the ones that live long: every interval and every timeout of a second or more.
 */
export function fileOfStack(_stack: string): string | null {
  return null;
}

export function probeTimers() {
  const alive = new Map<unknown, { file: string; ms: number }>();
  const real = {
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
  };
  const fileOf = () => {
    const frame = (new Error().stack ?? "")
      .split("\n")
      .find((line) => line.includes("/apps/daemon/src/"));
    return frame?.replace(/^.*\/apps\/daemon\/src\//, "").replace(/:\d+:\d+\)?$/, "") ?? null;
  };
  const any = globalThis as unknown as Record<string, unknown>;
  any.setInterval = (fn: () => void, ms: number, ...args: unknown[]) => {
    const handle = (real.setInterval as (...a: unknown[]) => unknown)(fn, ms, ...args);
    const file = fileOf();
    if (file) alive.set(handle, { file, ms });
    return handle;
  };
  any.setTimeout = (fn: (...a: unknown[]) => void, ms: number, ...args: unknown[]) => {
    const file = fileOf();
    const handle: unknown = (real.setTimeout as (...a: unknown[]) => unknown)(
      (...inner: unknown[]) => {
        alive.delete(handle);
        fn(...inner);
      },
      ms,
      ...args,
    );
    if (file && ms >= 1000) alive.set(handle, { file, ms });
    return handle;
  };
  any.clearInterval = (handle: unknown) => {
    alive.delete(handle);
    (real.clearInterval as (h: unknown) => void)(handle);
  };
  any.clearTimeout = (handle: unknown) => {
    alive.delete(handle);
    (real.clearTimeout as (h: unknown) => void)(handle);
  };
  return {
    /** What is running now, as "file period in ms", sorted. */
    list: () =>
      [...alive.values()]
        .map((timer) => `${timer.file} ${timer.ms}`)
        .sort((a, b) => a.localeCompare(b)),
    restore: () => Object.assign(globalThis, real),
  };
}
