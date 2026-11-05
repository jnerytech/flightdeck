import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { byCodeUnit } from "@flightdeck/protocol";
import { writeFileAtomic } from "../atomic-write.ts";

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

export type TelemetryStatus = "installed" | "absent" | "outdated" | "conflict";

export type InstallResult = { ok: true } | { ok: false; keys: string[] };

type Settings = Record<string, unknown> & { env?: Record<string, string> };

async function readSettings(file: string): Promise<Settings | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeSettings(file: string, settings: Settings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** The exporter in `env` is Flightdeck's own: a loopback endpoint with a bearer header. */
const isOurs = (env: Record<string, string> | undefined) =>
  /^http:\/\/127\.0\.0\.1:\d+$/.test(env?.OTEL_EXPORTER_OTLP_ENDPOINT ?? "") &&
  (env?.OTEL_EXPORTER_OTLP_HEADERS ?? "").startsWith("Authorization=Bearer ");

const present = (env: Record<string, string> | undefined) =>
  MANAGED_KEYS.filter((key) => env?.[key] !== undefined).sort(byCodeUnit);

/** The managed keys that hold a value of the user's, which install would have to overwrite. */
export async function telemetryConflicts(file: string): Promise<string[]> {
  const env = (await readSettings(file))?.env;
  return isOurs(env) ? [] : present(env);
}

/**
 * Adds Flightdeck's keys to `env` of settings.json, after a `.flightdeck-telemetry-backup` copy
 * of what the user had. A managed key that holds a value of the user's is never overwritten:
 * the call refuses and names the keys.
 */
export async function installTelemetry(
  file: string,
  target: TelemetryTarget,
): Promise<InstallResult> {
  const keys = await telemetryConflicts(file);
  if (keys.length > 0) return { ok: false, keys };
  const current = await readSettings(file);
  if (current && !isOurs(current.env)) {
    await copyFile(file, `${file}.flightdeck-telemetry-backup`);
  }
  await writeSettings(file, { ...current, env: { ...current?.env, ...telemetryEnv(target) } });
  return { ok: true };
}

/** Removes only Flightdeck's keys; false when there were none. */
export async function uninstallTelemetry(file: string): Promise<boolean> {
  const current = await readSettings(file);
  if (!current || !isOurs(current.env)) return false;
  const env = Object.fromEntries(
    Object.entries(current.env ?? {}).filter(([key]) => !MANAGED_KEYS.includes(key)),
  );
  const { env: _env, ...rest } = current;
  const settings = Object.keys(env).length > 0 ? { ...rest, env } : rest;
  if (Object.keys(settings).length === 0) await rm(file);
  else await writeSettings(file, settings);
  return true;
}

export async function telemetryStatus(
  file: string,
  target: TelemetryTarget,
): Promise<TelemetryStatus> {
  const env = (await readSettings(file))?.env;
  if (!isOurs(env)) return present(env).length > 0 ? "conflict" : "absent";
  const expected = telemetryEnv(target);
  return MANAGED_KEYS.every((key) => env?.[key] === expected[key]) ? "installed" : "outdated";
}
