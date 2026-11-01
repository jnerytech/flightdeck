/** The settings an exporter needs to reach the daemon's OTLP receiver. */
export interface TelemetryTarget {
  /** Base URL of the receiver, `http://127.0.0.1:<port>`. */
  url: string;
  token: string;
}

/** Every `env` key Flightdeck writes, in settings.json and in the wrapper's environment. */
export const MANAGED_KEYS: readonly string[] = [];

/** The variables that point Claude Code's exporters at the receiver. Never any `OTEL_LOG_*`. */
export function telemetryEnv(_target: TelemetryTarget): Record<string, string> {
  return {};
}

/** What the wrapper adds to the environment of the claude it opens; nothing over the user's own. */
export function wrapperTelemetryEnv(
  _base: Record<string, string | undefined>,
  _target: TelemetryTarget | null,
): Record<string, string> {
  return {};
}

export type TelemetryStatus = "installed" | "absent" | "outdated" | "conflict";

export type InstallResult = { ok: true } | { ok: false; keys: string[] };

/** Adds Flightdeck's keys to `env` of settings.json; refuses over a value that is not its own. */
export function installTelemetry(_file: string, _target: TelemetryTarget): InstallResult {
  return { ok: true };
}

/** Removes only Flightdeck's keys; false when there were none. */
export function uninstallTelemetry(_file: string): boolean {
  return false;
}

export function telemetryStatus(_file: string, _target: TelemetryTarget): TelemetryStatus {
  return "absent";
}
