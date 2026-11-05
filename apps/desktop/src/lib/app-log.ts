import type { LogSink } from "../platform/types.ts";

export type LogLevel = "info" | "warn" | "error";

export interface AppLogOptions {
  sink?: LogSink | undefined;
  now?: () => number;
}

/** The app's log: redacts, stamps and hands each line to the shell's file. (Stub.) */
export class AppLog {
  constructor(_opts: AppLogOptions = {}) {}
  log(_level: LogLevel, _source: string, _message: string): void {}
  recent(_lines: number): string[] {
    return [];
  }
}

/** Forwards the webview's console errors, errors and unhandled rejections to the log. (Stub.) */
export function installGlobalLog(
  _target: {
    addEventListener(type: string, listener: (event: never) => void): void;
    removeEventListener(type: string, listener: (event: never) => void): void;
  },
  _log: AppLog,
  _console?: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): () => void {
  return () => {};
}

export interface DiagnosticsInput {
  appVersion: string;
  os: string;
  hosts: Array<{ name: string; version: string | null; features: string[]; status: string }>;
  lines: string[];
}

/** What a person pastes in a message when something broke. (Stub.) */
export function diagnosticsText(_input: DiagnosticsInput): string {
  return "";
}
