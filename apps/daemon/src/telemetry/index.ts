/**
 * The telemetry domain's public entry (#1589): Claude Code's OTLP export, received locally.
 * Another domain imports from here, never a file inside.
 */
export { TelemetryOptIn } from "./optin.ts";
export type { TelemetryStatus } from "./otlp-env.ts";
