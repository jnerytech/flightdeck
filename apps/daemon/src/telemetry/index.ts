/**
 * The telemetry domain's public entry (#1589): Claude Code's OTLP export, received locally.
 * `main.ts` still builds the domain from `wiring.ts`. Another domain imports from here, never a file
 * inside.
 */
export { TelemetryOptIn } from "./optin.ts";
export { type TelemetryStatus, type TelemetryTarget, wrapperTelemetryEnv } from "./otlp-env.ts";
export type { TelemetryStore } from "./store.ts";
