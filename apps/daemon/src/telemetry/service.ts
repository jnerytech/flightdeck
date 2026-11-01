import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TELEMETRY_FILE } from "../central/wrapper.ts";
import { type Config, generateToken, updateConfigFile } from "../config.ts";
import { type OtlpEvent, startOtlpReceiver } from "./otlp.ts";

export interface TelemetryOptions {
  config: Config;
  configFile: string;
  log: { error(message: string): void };
  onEvents: (events: OtlpEvent[]) => void;
}

export interface TelemetryService {
  /** The receiver's URL; `null` when telemetry is off or the port could not be taken. */
  url: string | null;
  stop(): Promise<void>;
}

/** The token as the config file has it right now, so a rotation takes effect without a restart. */
function currentToken(configFile: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(configFile, "utf8")) as { telemetry?: { token?: unknown } };
    return typeof raw.telemetry?.token === "string" ? raw.telemetry.token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The OTLP receiver of Claude Code's telemetry (phase 23): on `telemetry.port`, `hooks.port + 1`
 * when absent, with the token of its own that this makes the first time. Its URL goes to
 * `telemetry.json` in `dataDir`, where `flightdeckd claude` finds it. A port that is taken is
 * logged and the daemon goes on without the receiver.
 */
export function startTelemetry(opts: TelemetryOptions): TelemetryService {
  const { config, configFile } = opts;
  const off: TelemetryService = { url: null, stop: async () => {} };
  if (!config.telemetry.enabled) return off;
  if (!config.telemetry.token) {
    updateConfigFile(configFile, (raw) => ({
      ...raw,
      telemetry: { ...(raw.telemetry as object), token: generateToken() },
    }));
  }
  const port = config.telemetry.port ?? (config.hooks.port === 0 ? 0 : config.hooks.port + 1);
  try {
    const receiver = startOtlpReceiver({
      port,
      token: () => currentToken(configFile),
      onEvents: opts.onEvents,
    });
    mkdirSync(config.dataDir, { recursive: true });
    const file = join(config.dataDir, TELEMETRY_FILE);
    writeFileSync(file, JSON.stringify({ url: receiver.url }));
    return {
      url: receiver.url,
      stop: async () => {
        rmSync(file, { force: true });
        await receiver.stop();
      },
    };
  } catch (error) {
    opts.log.error(
      `telemetry: the receiver could not listen on port ${port}: ${(error as Error).message}`,
    );
    return off;
  }
}
