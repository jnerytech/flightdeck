/** Reconnect delay for the given attempt (0-based): exponential from `base`, capped at `max`. */
export function backoffDelay(attempt: number, base = 1000, max = 30_000): number {
  return Math.min(max, base * 2 ** attempt);
}
