/** The settings an exporter needs to reach the daemon's OTLP receiver. */
export interface TelemetryTarget {
  /** Base URL of the receiver, `http://127.0.0.1:<port>`. */
  url: string;
  token: string;
}

/**
 * The variables that point Claude Code's exporters at the receiver. Prompts, responses, tool
 * details and API bodies stay off, as Claude Code has them by default: nothing here ever sets an
 * `OTEL_LOG_*` variable.
 */
export function telemetryEnv(target: TelemetryTarget): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: target.url,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${target.token}`,
    OTEL_LOGS_EXPORT_INTERVAL: "2000",
    OTEL_METRIC_EXPORT_INTERVAL: "30000",
  };
}

/** Every `env` key Flightdeck writes, in settings.json and in the wrapper's environment. */
export const MANAGED_KEYS: readonly string[] = Object.keys(telemetryEnv({ url: "", token: "" }));

/** What the wrapper adds to the environment of the claude it opens; nothing over the user's own. */
export function wrapperTelemetryEnv(
  base: Record<string, string | undefined>,
  target: TelemetryTarget | null,
): Record<string, string> {
  if (!target || MANAGED_KEYS.some((key) => base[key] !== undefined)) return {};
  return telemetryEnv(target);
}
