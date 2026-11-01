import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandHome, loadConfig, updateConfigFile } from "../src/config.ts";
import { runCli } from "../src/main.ts";
import type { OtlpEvent } from "../src/telemetry/otlp.ts";
import {
  installTelemetry,
  MANAGED_KEYS,
  type TelemetryTarget,
  telemetryEnv,
  telemetryStatus,
  uninstallTelemetry,
  wrapperTelemetryEnv,
} from "../src/telemetry/otlp-env.ts";
import { startTelemetry } from "../src/telemetry/service.ts";
import { installFakeClaude } from "./fake-claude.ts";
import { tempDir } from "./helpers.ts";
import { jsonLogs } from "./otlp-helpers.ts";

const TARGET: TelemetryTarget = {
  url: "http://127.0.0.1:7422",
  token: "tel-token-0123456789abcdef",
};

const EXPECTED_ENV = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:7422",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tel-token-0123456789abcdef",
  OTEL_LOGS_EXPORT_INTERVAL: "2000",
  OTEL_METRIC_EXPORT_INTERVAL: "30000",
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const ORIGINAL = {
  model: "opus",
  env: { MY_VAR: "1", OTEL_LOG_USER_PROMPTS: "0" },
  permissions: { allow: ["Bash(ls:*)"] },
};

function settingsFile(content?: object): string {
  const file = join(tempDir(), "settings.json");
  if (content) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

describe("otlp-ligar: the variables", () => {
  test("they point the exporters at the receiver, with the token and short intervals, and never turn content on", () => {
    expect(telemetryEnv(TARGET)).toEqual(EXPECTED_ENV);
    expect([...MANAGED_KEYS].sort()).toEqual(Object.keys(EXPECTED_ENV).sort());
    expect(MANAGED_KEYS.filter((key) => key.startsWith("OTEL_LOG_"))).toEqual([]);
    expect(Object.keys(telemetryEnv(TARGET)).filter((key) => key.startsWith("OTEL_LOG_"))).toEqual(
      [],
    );
  });

  test("the wrapper adds them to a claude with no exporter of its own, and nothing over one that has", () => {
    expect(wrapperTelemetryEnv({}, TARGET)).toEqual(EXPECTED_ENV);
    expect(wrapperTelemetryEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: undefined }, TARGET)).toEqual(
      EXPECTED_ENV,
    );
    expect(wrapperTelemetryEnv({}, null)).toEqual({});
    for (const key of MANAGED_KEYS) {
      expect(wrapperTelemetryEnv({ [key]: "theirs" }, TARGET)).toEqual({});
    }
  });
});

describe("otlp-ligar: the opt-in in settings.json", () => {
  test("install merges the keys into env, keeps everything else and backs the file up", () => {
    const file = settingsFile(ORIGINAL);
    const before = readFileSync(file, "utf8");
    expect(installTelemetry(file, TARGET)).toEqual({ ok: true });
    expect(read(file)).toEqual({
      ...ORIGINAL,
      env: { ...ORIGINAL.env, ...EXPECTED_ENV },
    });
    expect(readFileSync(`${file}.flightdeck-telemetry-backup`, "utf8")).toBe(before);
    expect(installTelemetry(file, TARGET)).toEqual({ ok: true });
    expect(read(file).env).toEqual({ ...ORIGINAL.env, ...EXPECTED_ENV });
  });

  test("a value of the user's in any managed key is never overwritten: install refuses and names the keys", () => {
    const mine = {
      ...ORIGINAL,
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
        OTEL_LOGS_EXPORTER: "console",
      },
    };
    const file = settingsFile(mine);
    const before = readFileSync(file, "utf8");
    expect(installTelemetry(file, TARGET)).toEqual({
      ok: false,
      keys: ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_LOGS_EXPORTER"],
    });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(`${file}.flightdeck-telemetry-backup`)).toBe(false);
    expect(telemetryStatus(file, TARGET)).toBe("conflict");
  });

  test("uninstall takes out only Flightdeck's keys and gives the original back; an absent file is removed again", () => {
    const file = settingsFile(ORIGINAL);
    installTelemetry(file, TARGET);
    expect(uninstallTelemetry(file)).toBe(true);
    expect(read(file)).toEqual(ORIGINAL);
    expect(uninstallTelemetry(file)).toBe(false);

    const fresh = settingsFile();
    installTelemetry(fresh, TARGET);
    expect(existsSync(`${fresh}.flightdeck-telemetry-backup`)).toBe(false);
    expect(uninstallTelemetry(fresh)).toBe(true);
    expect(existsSync(fresh)).toBe(false);
    expect(uninstallTelemetry(fresh)).toBe(false);
  });

  test("uninstall leaves a user's own exporter alone", () => {
    const file = settingsFile({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com", OTEL_LOGS_EXPORTER: "otlp" },
    });
    expect(uninstallTelemetry(file)).toBe(false);
    expect(read(file).env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("https://otel.example.com");
  });

  test("status: absent, installed, outdated (another token or port) and conflict", () => {
    const file = settingsFile(ORIGINAL);
    expect(telemetryStatus(file, TARGET)).toBe("absent");
    expect(telemetryStatus(join(tempDir(), "none.json"), TARGET)).toBe("absent");
    installTelemetry(file, TARGET);
    expect(telemetryStatus(file, TARGET)).toBe("installed");
    expect(telemetryStatus(file, { ...TARGET, token: "another-token-0123456789" })).toBe(
      "outdated",
    );
    expect(telemetryStatus(file, { ...TARGET, url: "http://127.0.0.1:9999" })).toBe("outdated");
  });
});

describe("otlp-ligar: the wrapper", () => {
  function config(options: { token?: string; url?: string } = {}) {
    const dir = tempDir();
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir,
        hooks: { port: 0, token: "hooks-token-0123456789" },
        ...(options.token ? { telemetry: { token: options.token } } : {}),
      }),
    );
    if (options.url)
      writeFileSync(join(dataDir, "telemetry.json"), JSON.stringify({ url: options.url }));
    return file;
  }

  async function launch(args: string[], file: string, env: Record<string, string> = {}) {
    const fake = installFakeClaude([{ do: "exit", code: 0 }]);
    cleanups.push(fake.restore);
    await runCli(["claude", ...args], {
      env: { ...process.env, FLIGHTDECK_CONFIG: file, ...env },
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
      selfCommand: ["C:\\fd\\flightdeckd.exe"],
    });
    const start = fake.events().find((e) => e.type === "start") as unknown as {
      env: Record<string, string>;
    };
    return start.env;
  }

  const telemetryKeys = (env: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(env).filter(
        ([k]) => k === "CLAUDE_CODE_ENABLE_TELEMETRY" || k.startsWith("OTEL_"),
      ),
    );

  test("claude opened by the wrapper gets the variables, with the config's telemetry token and the published URL", async () => {
    const env = await launch(["-c"], config({ token: TARGET.token, url: TARGET.url }));
    expect(telemetryKeys(env)).toEqual(EXPECTED_ENV);
  });

  test("print mode, a daemon that published no receiver or no token: plain claude, no exporter", async () => {
    const withBoth = config({ token: TARGET.token, url: TARGET.url });
    expect(telemetryKeys(await launch(["-p", "oi"], withBoth))).toEqual({});
    expect(telemetryKeys(await launch(["-c"], config({ token: TARGET.token })))).toEqual({});
    expect(telemetryKeys(await launch(["-c"], config({ url: TARGET.url })))).toEqual({});
  });

  test("an exporter the user already set is theirs: nothing is added over it", async () => {
    const file = config({ token: TARGET.token, url: TARGET.url });
    const env = await launch(["-c"], file, {
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
    });
    expect(telemetryKeys(env)).toEqual({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com" });
  });
});

describe("otlp-ligar: flightdeckd telemetry", () => {
  const out: string[] = [];
  let exitCode: number | null = null;
  afterEach(() => {
    out.length = 0;
    exitCode = null;
  });
  const deps = {
    env: {},
    log: { log: (m: string) => out.push(m), error: (m: string) => out.push(m) },
    exit: (code: number) => {
      exitCode = code;
    },
    onSignal: () => {},
    selfCommand: ["C:\\fd\\flightdeckd.exe"],
  };
  function config(extra: Record<string, unknown> = {}): string {
    const file = join(tempDir(), "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        token: "t".repeat(32),
        dataDir: join(tempDir(), "d"),
        hooks: { port: 7500, token: "hooks-token-0123456789" },
        ...extra,
      }),
    );
    return file;
  }
  const settings = () => expandHome("~/.claude/settings.json");

  test("install makes its own token, writes the opt-in on hooks.port + 1, and uninstall rotates the token", async () => {
    rmSync(settings(), { force: true });
    const file = config();
    await runCli(["telemetry", "install", "--config", file], deps);
    expect(exitCode).toBe(0);
    const token = loadConfig(file).telemetry.token ?? "";
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token).not.toBe("hooks-token-0123456789");
    expect(token).not.toBe("t".repeat(32));
    expect(read(settings()).env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:7501");
    expect(read(settings()).env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${token}`);
    await runCli(["telemetry", "status", "--config", file], deps);
    expect(out.join("\n")).toContain("telemetry: installed");
    await runCli(["telemetry", "install", "--config", file], deps);
    expect(loadConfig(file).telemetry.token).toBe(token);
    await runCli(["telemetry", "uninstall", "--config", file], deps);
    expect(existsSync(settings())).toBe(false);
    const rotated = loadConfig(file).telemetry.token ?? "";
    expect(rotated.length).toBeGreaterThanOrEqual(16);
    expect(rotated).not.toBe(token);
    await runCli(["telemetry", "status", "--config", file], deps);
    expect(out.join("\n")).toContain("telemetry: absent");
  });

  test("telemetry.port wins over hooks.port + 1", async () => {
    rmSync(settings(), { force: true });
    await runCli(["telemetry", "install", "--config", config({ telemetry: { port: 7611 } })], deps);
    expect(read(settings()).env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://127.0.0.1:7611");
    rmSync(settings(), { force: true });
  });

  test("a user's own exporter stops install with the keys named, and nothing is written", async () => {
    mkdirSync(join(settings(), ".."), { recursive: true });
    writeFileSync(settings(), JSON.stringify({ env: { OTEL_LOGS_EXPORTER: "console" } }));
    const file = config();
    await runCli(["telemetry", "install", "--config", file], deps);
    expect(exitCode).toBe(1);
    expect(out.join("\n")).toContain("OTEL_LOGS_EXPORTER");
    expect(read(settings())).toEqual({ env: { OTEL_LOGS_EXPORTER: "console" } });
    expect(loadConfig(file).telemetry.token).toBeUndefined();
    rmSync(settings(), { force: true });
  });

  test("without a fixed port install is refused, and an unknown action is a usage error", async () => {
    await runCli(["telemetry", "install", "--config", config({ hooks: { port: 0 } })], deps);
    expect(exitCode).toBe(1);
    expect(out.join("\n")).toContain("telemetry.port");
    let message = "accepted";
    try {
      const { parseArgs } = await import("../src/main.ts");
      parseArgs(["telemetry", "wipe"]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("invalid telemetry action: wipe");
  });
});

describe("otlp-ligar: the daemon's receiver", () => {
  function setup(telemetry: Record<string, unknown> = { port: 0 }) {
    const dir = tempDir();
    const dataDir = join(dir, "data");
    mkdirSync(dataDir, { recursive: true });
    const configFile = join(dir, "config.json");
    writeFileSync(
      configFile,
      JSON.stringify({ token: "t".repeat(32), dataDir, hooks: { port: 0 }, telemetry }),
    );
    const errors: string[] = [];
    const got: OtlpEvent[][] = [];
    const service = startTelemetry({
      config: loadConfig(configFile),
      configFile,
      log: { error: (m) => errors.push(m) },
      onEvents: (events) => got.push(events),
    });
    cleanups.push(() => service.stop());
    return { service, dataDir, configFile, errors, got };
  }
  const send = (url: string | null, token: string) =>
    fetch(`${url}/v1/logs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: jsonLogs([{ name: "api_error", timeMs: 1, attrs: { "session.id": "s" } }]),
    });

  test("it makes the token once, listens, publishes its URL for the wrapper and removes it on stop", async () => {
    const { service, dataDir, configFile, got } = setup();
    const token = loadConfig(configFile).telemetry.token ?? "";
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(read(join(dataDir, "telemetry.json"))).toEqual({ url: service.url });
    expect((await send(service.url, token)).status).toBe(200);
    expect(got.map((events) => events.map((e) => e.name))).toEqual([["api_error"]]);
    await service.stop();
    expect(existsSync(join(dataDir, "telemetry.json"))).toBe(false);
  });

  test("a token rotated in the config file takes effect at once, without a restart", async () => {
    const { service, configFile } = setup({ port: 0, token: "first-token-0123456789" });
    expect((await send(service.url, "first-token-0123456789")).status).toBe(200);
    updateConfigFile(configFile, (raw) => ({
      ...raw,
      telemetry: { port: 0, token: "second-token-0123456789" },
    }));
    expect((await send(service.url, "first-token-0123456789")).status).toBe(401);
    expect((await send(service.url, "second-token-0123456789")).status).toBe(200);
  });

  test("telemetry off: no receiver, no file, no token", () => {
    const { service, dataDir, configFile } = setup({ enabled: false, port: 0 });
    expect(service.url).toBeNull();
    expect(existsSync(join(dataDir, "telemetry.json"))).toBe(false);
    expect(loadConfig(configFile).telemetry.token).toBeUndefined();
  });

  test("a port that is taken is logged and the daemon carries on without the receiver", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    cleanups.push(() => taken.stop(true));
    const { service, dataDir, errors } = setup({ port: taken.port });
    expect(service.url).toBeNull();
    expect(errors.join("\n")).toContain(`${taken.port}`);
    expect(existsSync(join(dataDir, "telemetry.json"))).toBe(false);
  });
});
