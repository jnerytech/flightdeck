import { localDay } from "../features/costs/index.ts";
import { formatDateTime, formatTime, formatWhen } from "../i18n/format.ts";
import type { Lang } from "../i18n/types.ts";
import type { AppStoreOptions } from "../lib/app-state.ts";

/** The timers of the store when a test does not inject its own. */
const REAL_TIMERS = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type ClockOptions = Pick<
  AppStoreOptions,
  "now" | "day" | "formatTime" | "timeZone" | "timers" | "githubTicker"
>;

/** The time of the app: what "now" is, how an instant is shown, and the timers tests drive. */
export class Clock {
  /** The timers behind `later` (the injected ones, or the real ones). */
  readonly timers: NonNullable<ClockOptions["timers"]>;

  constructor(
    private readonly options: ClockOptions,
    /** The app's language, read when an instant is shown. */
    private readonly lang: () => Lang,
  ) {
    this.timers = options.timers ?? REAL_TIMERS;
  }

  /** Milliseconds now (injected in tests). */
  now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Today as `YYYY-MM-DD`, in this machine's time zone unless injected. */
  today(): string {
    return (this.options.day ?? localDay)(this.now());
  }

  /** HH:MM of an instant, in this machine's time zone unless injected. */
  formatTime(iso: string): string {
    if (this.options.formatTime) return this.options.formatTime(iso);
    return formatTime(iso, this.lang(), this.options.timeZone);
  }

  /** Date and time of an instant in local time, in the app's language (phase 10). */
  formatDateTime(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatDateTime(iso, this.lang(), this.options.timeZone);
  }

  /** A list's short time: HH:MM today, the day and month before (phase 10). */
  formatWhen(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatWhen(iso, this.now(), this.lang(), this.options.timeZone);
  }

  /** Runs `fn` after `ms` (the store's timers, which tests drive); returns the function that cancels. */
  later(fn: () => void, ms: number): () => void {
    const handle = this.timers.setTimeout(fn, ms);
    return () => this.timers.clearTimeout(handle);
  }

  /** Starts the poll the GitHub panel runs while a sign-in waits; the returned function stops it. */
  githubTicker(tick: () => void): () => void {
    if (this.options.githubTicker) return this.options.githubTicker(tick);
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }
}
