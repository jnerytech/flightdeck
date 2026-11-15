import { SecretScanner, scrubHome } from "@flightdeck/protocol";
import type { LogLevel } from "@/shared/lib/index.ts";
import type { LogSink } from "../platform/types.ts";
import { isReactError, type ReactErrorInfo, reactErrorLine } from "./domain/react-error-line.ts";

export { isReactError, type ReactErrorInfo, reactErrorLine };

export interface AppLogOptions {
  sink?: LogSink;
  /** Values that must never be written: vault values, host tokens (read at each line). */
  values?: () => string[];
  now?: () => number;
}

/** How many lines the app keeps in memory for "Copy diagnostics". */
const KEEP = 200;
/** A message is cut here: a log line is for reading, not for dumping a payload. */
const MAX_MESSAGE = 2000;
/** A source may log this many lines at once (issue #259)... */
export const LOG_BURST = 50;
/** ...and gets this many more each second, up to the burst. */
const LOG_PER_SECOND = 10;
/** Lines waiting for the write in flight, at most: a sink that hangs holds no more. */
export const LOG_QUEUE = 500;

/** One source's budget: a token bucket refilled from the clock. */
interface Budget {
  tokens: number;
  at: number;
  dropped: number;
}

/**
 * The app's log. Every line is redacted by the protocol's secret scanner before it goes anywhere
 * (the shell's log file, or the memory the diagnostics read), so no token, key, pairing link or
 * vault value is ever written. A sink that fails is ignored: logging never breaks the app.
 *
 * A storm stays bounded (issue #259): each source has a rate, checked before a line is kept, so one
 * noisy source cannot push the others out; and one write is in flight at a time, with what arrives
 * meanwhile sent as one batch when it settles, so a burst is one call per round trip and the
 * first line of an error is on disk at once. A log made while a line is being logged (by the
 * sink, the scanner or a console call they make) is dropped instead of looping.
 */
export class AppLog {
  private readonly now: () => number;
  private lines: string[] = [];
  private readonly scanner: SecretScanner;
  private readonly budgets = new Map<string, Budget>();
  private queue: string[] = [];
  private overflow = 0;
  private writing: Promise<void> | null = null;
  private busy = false;

  constructor(private readonly opts: AppLogOptions = {}) {
    this.now = opts.now ?? Date.now;
    const values = opts.values;
    this.scanner = new SecretScanner(values ? () => values() : () => []);
  }

  log(level: LogLevel, source: string, message: string): void {
    if (this.busy) return;
    this.busy = true;
    try {
      const at = this.now();
      const budget = this.spend(source, at);
      if (!budget) return;
      if (budget.dropped > 0) {
        this.keep(
          this.line(
            at,
            "warn",
            "app-log",
            `${budget.dropped} lines of ${source} dropped by the rate limit`,
          ),
        );
        budget.dropped = 0;
      }
      const text = scrubHome(this.scanner.redact(message, false))
        .replace(/[\r\n]+/g, " ")
        .slice(0, MAX_MESSAGE);
      this.keep(this.line(at, level, source, text));
    } finally {
      this.busy = false;
    }
  }

  /** Resolves once every line logged so far has been handed to the sink and settled. */
  flush(): Promise<void> {
    return this.writing ? this.writing.then(() => this.flush()) : Promise.resolve();
  }

  /** The last `lines` lines, newest last. */
  recent(lines: number): string[] {
    return lines <= 0 ? [] : this.lines.slice(-lines);
  }

  private line(at: number, level: LogLevel, source: string, text: string): string {
    return `${new Date(at).toISOString()} ${level.toUpperCase()} ${source} ${text}`;
  }

  /** The source's budget with one line taken from it, or null (and counted) when it has none. */
  private spend(source: string, at: number): Budget | null {
    const budget = this.budgets.get(source) ?? { tokens: LOG_BURST, at, dropped: 0 };
    this.budgets.set(source, budget);
    budget.tokens = Math.min(LOG_BURST, budget.tokens + ((at - budget.at) / 1000) * LOG_PER_SECOND);
    budget.at = at;
    if (budget.tokens < 1) {
      budget.dropped++;
      return null;
    }
    budget.tokens--;
    return budget;
  }

  private keep(line: string): void {
    this.lines = [...this.lines, line].slice(-KEEP);
    if (!this.opts.sink) return;
    if (this.queue.length >= LOG_QUEUE) this.overflow++;
    else this.queue.push(line);
    if (!this.writing) this.drain();
  }

  /** Hands the queue to the sink as one batch; when it settles, the next batch goes. */
  private drain(): void {
    const sink = this.opts.sink;
    if (!sink || (this.queue.length === 0 && this.overflow === 0)) {
      this.writing = null;
      return;
    }
    const batch = this.queue;
    if (this.overflow > 0) {
      const at = this.now();
      batch.unshift(
        this.line(
          at,
          "warn",
          "app-log",
          `${this.overflow} lines dropped: the log file could not keep up`,
        ),
      );
    }
    this.queue = [];
    this.overflow = 0;
    // A sink that throws at once rejects here, as good as one that fails later.
    const sent = (async () => sink.write(batch))();
    this.writing = sent.catch(() => {}).then(() => this.drain());
  }
}

const show = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** The screen's name, or "unknown" when the route cannot be read (the app is not up yet). */
function screenOf(screen: () => string): string {
  try {
    return screen();
  } catch {
    return "unknown";
  }
}

/** The `createRoot` options that log the errors React catches in a tree (its error boundaries). */
export function reactRootErrorHandlers(log: AppLog, screen: () => string) {
  const report = (kind: string) => (error: unknown, info: ReactErrorInfo) =>
    log.log("error", "react", `${kind}: ${reactErrorLine(error, info, screenOf(screen))}`);
  return {
    onUncaughtError: report("uncaught"),
    onCaughtError: report("caught"),
    onRecoverableError: report("recoverable"),
  };
}

/** The consoles the log is installed on: a second install would forward each call twice. */
const installed = new WeakSet<object>();

/**
 * Forwards what the webview reports on its own to the log: errors, unhandled rejections and the
 * console's errors and warnings (the console still prints them). Returns what takes it all off.
 * On a console it is already installed on, it does nothing and returns nothing to take off.
 */
export function installGlobalLog(
  target: {
    addEventListener(type: string, listener: (event: never) => void): void;
    removeEventListener(type: string, listener: (event: never) => void): void;
  },
  log: AppLog,
  console_: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } = console,
  screen: () => string = () => "unknown",
): () => void {
  if (installed.has(console_)) return () => {};
  installed.add(console_);
  const placed = (reason: unknown) => {
    if (isReactError(reason)) {
      log.log("error", "react", reactErrorLine(reason, {}, screenOf(screen)));
    }
  };
  const onError = (event: { message?: string; filename?: string; lineno?: number }) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno ?? 0})` : "";
    log.log("error", "window", `${event.message ?? "error"}${where}`);
  };
  const onRejection = (event: { reason?: unknown }) => {
    log.log("error", "rejection", show(event.reason));
    placed(event.reason);
  };
  target.addEventListener("error", onError as (event: never) => void);
  target.addEventListener("unhandledrejection", onRejection as (event: never) => void);
  const { error, warn } = console_;
  console_.error = (...args: unknown[]) => {
    error.apply(console_, args);
    log.log("error", "console", args.map(show).join(" "));
  };
  console_.warn = (...args: unknown[]) => {
    warn.apply(console_, args);
    log.log("warn", "console", args.map(show).join(" "));
  };
  return () => {
    target.removeEventListener("error", onError as (event: never) => void);
    target.removeEventListener("unhandledrejection", onRejection as (event: never) => void);
    console_.error = error;
    console_.warn = warn;
    installed.delete(console_);
  };
}
