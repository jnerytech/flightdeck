import type { Platform } from "../platform/types.ts";

/** How long Claude Code keeps the prompt cache: 5 minutes, or 1 hour with extended caching. */
export const CACHE_TTLS = [300_000, 3_600_000] as const;
export type CacheTtl = (typeof CACHE_TTLS)[number];

export const CACHE_TIMER_KEY = "flightdeck.cacheTimer";
export const CACHE_TTL_KEY = "flightdeck.cacheTtl";

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
  void ms;
  return "";
}

/** Where an idle session's prompt cache stands `nowMs`, or null when it is not known since when. */
export function cacheTimer(
  since: string | null | undefined,
  nowMs: number,
  ttlMs: number,
): CacheTimerView | null {
  void since;
  void nowMs;
  void ttlMs;
  return null;
}

/** Minutes and seconds of the time left, for the spoken form. */
export function spokenParts(ms: number): { minutes: number; seconds: number } {
  void ms;
  return { minutes: -1, seconds: -1 };
}

/** What the shared clock needs from the world; injected so tests need no real timers. */
export interface ClockDeps {
  now(): number;
  /** Calls `fn` every `ms`; returns the way to stop. */
  every(fn: () => void, ms: number): () => void;
  hidden(): boolean;
  /** Told when the window is hidden or shown again; returns the way to stop. */
  onVisibility(fn: () => void): () => void;
}

/** One 1-second clock for every timer on screen, stopped while nobody listens or the window is hidden. */
export class SharedClock {
  constructor(private readonly deps: ClockDeps) {}

  /** The current second, in ms. */
  now(): number {
    return this.deps.now();
  }

  subscribe = (listener: () => void): (() => void) => {
    void listener;
    return () => {};
  };
}

/** The prompt cache timer's settings, kept across starts: off by default. */
export class CacheTimerSettings {
  enabled = true;
  ttl: CacheTtl = 3_600_000;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    void this.storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setEnabled(enabled: boolean): void {
    void enabled;
  }

  setTtl(ttl: CacheTtl): void {
    void ttl;
  }
}
