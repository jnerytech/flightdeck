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
  private readonly listeners = new Set<() => void>();
  private stopTimer: (() => void) | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly deps: ClockDeps) {}

  /** The current time, in ms. */
  now(): number {
    return this.deps.now();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.stopWatching = this.deps.onVisibility(this.onVisibility);
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.stop();
      this.stopWatching?.();
      this.stopWatching = null;
    };
  };

  private start(): void {
    if (this.stopTimer || this.deps.hidden()) return;
    this.stopTimer = this.deps.every(() => this.emit(), 1000);
  }

  private stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Hidden: no timer runs. Shown again: it restarts and everyone catches up at once. */
  private readonly onVisibility = (): void => {
    if (this.deps.hidden()) this.stop();
    else if (!this.stopTimer) {
      this.start();
      this.emit();
    }
  };
}

/** The prompt cache timer's settings, kept across starts: off by default. */
export class CacheTimerSettings {
  enabled: boolean;
  ttl: CacheTtl;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: Platform["storage"]) {
    this.enabled = storage.getItem(CACHE_TIMER_KEY) === "on";
    const stored = Number(storage.getItem(CACHE_TTL_KEY));
    this.ttl = CACHE_TTLS.find((ttl) => ttl === stored) ?? CACHE_TTLS[0];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.storage.setItem(CACHE_TIMER_KEY, enabled ? "on" : "off");
    this.emit();
  }

  setTtl(ttl: CacheTtl): void {
    this.ttl = ttl;
    this.storage.setItem(CACHE_TTL_KEY, String(ttl));
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
