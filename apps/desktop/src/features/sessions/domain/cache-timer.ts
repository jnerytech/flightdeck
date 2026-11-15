/** How long Claude Code keeps the prompt cache: 5 minutes, or 1 hour with extended caching. */
export const CACHE_TTLS = [300_000, 3_600_000] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

export type CachePhase = "warm" | "warning" | "cold";

export interface CacheTimerView {
  phase: CachePhase;
  /** Milliseconds left, 0 once cold. */
  remainingMs: number;
  /** `m:ss` while counting; empty once cold (a quiet marker, no number). */
  text: string;
}

/** `m:ss` of a number of milliseconds, rounded up to the second. */
export function clockText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Where an idle session's prompt cache stands `nowMs`, or null when it is not known since when. */
export function cacheTimer(
  since: string | null | undefined,
  nowMs: number,
  ttlMs: number,
): CacheTimerView | null {
  const from = Date.parse(since ?? "");
  if (Number.isNaN(from)) return null;
  // A moment after now (clock skew between the host and this machine) counts as just ended.
  const remainingMs = ttlMs - Math.max(0, nowMs - from);
  if (remainingMs <= 0) return { phase: "cold", remainingMs: 0, text: "" };
  const warning = Math.ceil(remainingMs / 1000) <= 59;
  return { phase: warning ? "warning" : "warm", remainingMs, text: clockText(remainingMs) };
}

/** Minutes and seconds of the time left, for the spoken form. */
export function spokenParts(ms: number): { minutes: number; seconds: number } {
  const seconds = Math.ceil(ms / 1000);
  return { minutes: Math.floor(seconds / 60), seconds: seconds % 60 };
}
