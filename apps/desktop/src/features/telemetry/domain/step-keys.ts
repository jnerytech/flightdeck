import type { TelemetryItem } from "@flightdeck/protocol";

/**
 * The steps of a prompt with a React key each. `at` is epoch milliseconds, so two calls of one tool
 * in the same millisecond share what they are named by; the second gets a counter.
 */
export function stepKeys(items: readonly TelemetryItem[]): { key: string; item: TelemetryItem }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.at}-${item.kind}-${item.toolName ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n === 1 ? base : `${base}-${n}`, item };
  });
}
