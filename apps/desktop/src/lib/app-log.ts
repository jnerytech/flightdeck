import { SecretScanner } from "@flightdeck/protocol";
import type { LogSink } from "../platform/types.ts";

export type LogLevel = "info" | "warn" | "error";

export interface AppLogOptions {
  sink?: LogSink | undefined;
  /** Values that must never be written: vault values, host tokens (read at each line). */
  values?: () => string[];
  now?: () => number;
}

/** How many lines the app keeps in memory for "Copy diagnostics". */
const KEEP = 200;
/** A message is cut here: a log line is for reading, not for dumping a payload. */
const MAX_MESSAGE = 2000;
/** "Copy diagnostics" carries this many of the last lines. */
const DIAGNOSTIC_LINES = 50;

const scanner = new SecretScanner();

/**
 * The app's log. Every line is redacted by the protocol's secret scanner before it goes anywhere
 * (the shell's log file, or the memory the diagnostics read), so no token, key, pairing link or
 * vault value is ever written. A sink that fails is ignored: logging never breaks the app.
 */
export class AppLog {
  private readonly now: () => number;
  private lines: string[] = [];

  constructor(private readonly opts: AppLogOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  log(level: LogLevel, source: string, message: string): void {
    const text = scanner
      .redact(message)
      .replace(/[\r\n]+/g, " ")
      .slice(0, MAX_MESSAGE);
    const line = `${new Date(this.now()).toISOString()} ${level.toUpperCase()} ${source} ${text}`;
    this.lines = [...this.lines, line].slice(-KEEP);
    try {
      void this.opts.sink?.write(line).catch(() => {});
    } catch {
      // A sink that throws at once is as good as one that fails later.
    }
  }

  /** The last `lines` lines, newest last. */
  recent(lines: number): string[] {
    return lines <= 0 ? [] : this.lines.slice(-lines);
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

/**
 * Forwards what the webview reports on its own to the log: errors, unhandled rejections and the
 * console's errors and warnings (the console still prints them). Returns what takes it all off.
 */
export function installGlobalLog(
  target: {
    addEventListener(type: string, listener: (event: never) => void): void;
    removeEventListener(type: string, listener: (event: never) => void): void;
  },
  log: AppLog,
  console_: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } = console,
): () => void {
  const onError = (event: { message?: string; filename?: string; lineno?: number }) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno ?? 0})` : "";
    log.log("error", "window", `${event.message ?? "error"}${where}`);
  };
  const onRejection = (event: { reason?: unknown }) => {
    log.log("error", "rejection", show(event.reason));
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
  };
}

export interface DiagnosticsInput {
  appVersion: string;
  os: string;
  hosts: Array<{ name: string; version: string | null; features: string[]; status: string }>;
  lines: string[];
}

/**
 * What a person pastes in a message when something broke: the app's version and system, each
 * host's name, state, version and features (never a URL or a token), and the last 50 log lines,
 * redacted once more. It is meant for whoever helps, so it is in English whatever the app's language.
 */
export function diagnosticsText(input: DiagnosticsInput): string {
  const hosts = input.hosts.map(
    (host) =>
      `  ${host.name}: ${host.status}, flightdeckd ${host.version ?? "unknown"}, features: ${
        host.features.length === 0 ? "none" : host.features.join(", ")
      }`,
  );
  return [
    `Flightdeck ${input.appVersion}`,
    `System: ${input.os}`,
    "Hosts:",
    ...(hosts.length === 0 ? ["  none"] : hosts),
    "Last log lines:",
    ...input.lines.slice(-DIAGNOSTIC_LINES).map((line) => `  ${scanner.redact(line)}`),
  ].join("\n");
}
