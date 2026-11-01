import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { FlightdeckError } from "../src/errors.ts";
import { startServer } from "../src/server.ts";
import { TelemetryOptIn } from "../src/telemetry/optin.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "optin-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup(config: Record<string, unknown> = {}, settings?: object) {
  const dir = tempDir();
  const configFile = join(dir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({ token: "t".repeat(32), hooks: { port: 7600 }, ...config }),
  );
  const settingsFile = join(dir, "claude", "settings.json");
  if (settings) {
    mkdirSync(join(dir, "claude"), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  }
  const optIn = new TelemetryOptIn({ configFile, settingsPath: () => settingsFile });
  return { optIn, configFile, settingsFile };
}

type Ack = Record<string, unknown>;
const why = (ack: Ack) =>
  (ack.error ?? {}) as { reason?: string; params?: Record<string, string | number> };

function refusal(run: () => unknown): FlightdeckError {
  try {
    run();
  } catch (error) {
    if (error instanceof FlightdeckError) return error;
    throw error;
  }
  throw new Error("accepted");
}

describe("otlp-app: the opt-in for a plain claude, from the daemon", () => {
  test("install needs the confirmation, writes the keys on hooks.port + 1 with a token of its own, and uninstall rotates it", () => {
    const { optIn, configFile, settingsFile } = setup({}, { model: "opus" });
    expect(optIn.status()).toEqual({
      status: "absent",
      settingsPath: settingsFile,
      receiverUrl: "http://127.0.0.1:7601",
      conflicts: [],
    });
    const asked = refusal(() => optIn.install(false));
    expect(asked.code).toBe("invalid_state");
    expect(asked.reason).toBe("telemetry_confirm");
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ model: "opus" });

    const installed = optIn.install(true);
    expect(installed.status).toBe("installed");
    const token = loadConfig(configFile).telemetry.token ?? "";
    expect(token.length).toBeGreaterThanOrEqual(16);
    const env = JSON.parse(readFileSync(settingsFile, "utf8")).env;
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:7601");
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${token}`);
    expect(Object.keys(env).filter((k) => k.startsWith("OTEL_LOG_"))).toEqual([]);
    expect(existsSync(`${settingsFile}.flightdeck-telemetry-backup`)).toBe(true);
    expect(optIn.status().status).toBe("installed");

    expect(refusal(() => optIn.uninstall(false)).reason).toBe("telemetry_confirm");
    expect(optIn.uninstall(true).status).toBe("absent");
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ model: "opus" });
    expect(loadConfig(configFile).telemetry.token).not.toBe(token);
  });

  test("keys of the user's own are named, and nothing is written, not even the token", () => {
    const { optIn, configFile, settingsFile } = setup(
      {},
      {
        env: {
          OTEL_LOGS_EXPORTER: "console",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
        },
      },
    );
    const status = optIn.status();
    expect(status.status).toBe("conflict");
    expect(status.conflicts).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_LOGS_EXPORTER"]);
    const error = refusal(() => optIn.install(true));
    expect(error.reason).toBe("telemetry_owned_keys");
    expect(error.params).toEqual({ keys: "OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOGS_EXPORTER" });
    expect(JSON.parse(readFileSync(settingsFile, "utf8")).env.OTEL_LOGS_EXPORTER).toBe("console");
    expect(loadConfig(configFile).telemetry.token).toBeUndefined();
  });

  test("without a fixed port install is refused, and status says there is no receiver URL", () => {
    const { optIn } = setup({ hooks: { port: 0 } });
    expect(optIn.status().receiverUrl).toBeNull();
    expect(refusal(() => optIn.install(true)).reason).toBe("telemetry_port");
    const { optIn: fixed } = setup({ hooks: { port: 0 }, telemetry: { port: 7700 } });
    expect(fixed.status().receiverUrl).toBe("http://127.0.0.1:7700");
  });
});

describe("otlp-app: over the protocol", () => {
  async function served(withOptIn: boolean, settings?: object) {
    const { optIn } = setup({}, settings);
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      ...(withOptIn ? { telemetryOptIn: optIn } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  }

  test("status, install and uninstall answer, and a refusal carries its reason and the keys", async () => {
    const client = await served(true);
    expect((await client.data<{ status: string }>("telemetry.status", {}))?.status).toBe("absent");
    const refused = await client.request("telemetry.install", {});
    expect(refused.ok).toBe(false);
    expect(why(refused).reason).toBe("telemetry_confirm");
    expect(
      (await client.data<{ status: string }>("telemetry.install", { confirm: true }))?.status,
    ).toBe("installed");
    expect(
      (await client.data<{ status: string }>("telemetry.uninstall", { confirm: true }))?.status,
    ).toBe("absent");
  });

  test("a user's own key is refused with its name", async () => {
    const client = await served(true, { env: { OTEL_LOGS_EXPORTER: "console" } });
    const ack = await client.request("telemetry.install", { confirm: true });
    expect(ack.ok).toBe(false);
    expect(why(ack).reason).toBe("telemetry_owned_keys");
    expect(why(ack).params).toEqual({ keys: "OTEL_LOGS_EXPORTER" });
  });

  test("a host without it says the feature is off", async () => {
    const client = await served(false);
    const ack = await client.request("telemetry.status", {});
    expect(ack.ok).toBe(false);
    expect(why(ack).reason).toBe("feature_off");
  });
});
