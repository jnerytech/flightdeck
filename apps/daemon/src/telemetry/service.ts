import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.ts";
import { TELEMETRY_FILE } from "../central/wrapper.ts";
import { type Config, generateToken, updateConfigFile } from "../config.ts";
import { parseJsonOr } from "../json-text.ts";
import type { Logger } from "../kernel/index.ts";
import { type OtlpEvent, startOtlpReceiver } from "./otlp.ts";

export interface TelemetryOptions {
  config: Config;
  configFile: string;
  log: Pick<Logger, "error">;
  onEvents: (events: OtlpEvent[]) => void;
  /** Deletes what is past the retention; runs at start and every `purgeEveryMs` while listening. */
  purge?: () => void;
  purgeEveryMs?: number;
}

export interface TelemetryService {
  /** The receiver's URL; `null` when telemetry is off or the port could not be taken. */
  url: string | null;
  stop(): Promise<void>;
}

const HOUR_MS = 3_600_000;

const CONFIG_TOKEN = z.object({ telemetry: z.object({ token: z.unknown() }).partial().optional() });

/** The token as the config file has it right now, so a rotation takes effect without a restart. */
async function currentToken(configFile: string): Promise<string | undefined> {
  try {
    const raw = parseJsonOr(CONFIG_TOKEN, await readFile(configFile, "utf8"), null);
    return typeof raw?.telemetry?.token === "string" ? raw.telemetry.token : undefined;
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
export async function startTelemetry(opts: TelemetryOptions): Promise<TelemetryService> {
  const { config, configFile } = opts;
  const off: TelemetryService = { url: null, stop: async () => {} };
  // Like the hooks receptor, it listens only once the hooks are set up: a daemon without them opens no extra port.
  if (!config.telemetry.enabled || !config.hooks.token) return off;
  if (!config.telemetry.token) {
    await updateConfigFile(configFile, (raw) => ({
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
    await mkdir(config.dataDir, { recursive: true });
    const file = join(config.dataDir, TELEMETRY_FILE);
    await writeFileAtomic(file, JSON.stringify({ url: receiver.url }));
    // The retention runs only while the receiver does, so an idle daemon keeps no timer for it.
    opts.purge?.();
    const timer = opts.purge ? setInterval(opts.purge, opts.purgeEveryMs ?? HOUR_MS) : null;
    timer?.unref();
    return {
      url: receiver.url,
      stop: async () => {
        if (timer) clearInterval(timer);
        await rm(file, { force: true });
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
