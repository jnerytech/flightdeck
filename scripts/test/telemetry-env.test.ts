import { describe, expect, test } from "bun:test";
import { installGitEnvGuard, isTelemetryVar, scrubTelemetryEnv } from "./git-env.ts";

describe("isolamento: the caller's telemetry variables do not reach the tests", () => {
  test("the switch and every OTEL variable are telemetry; nothing else is", () => {
    expect(isTelemetryVar("CLAUDE_CODE_ENABLE_TELEMETRY")).toBe(true);
    expect(isTelemetryVar("OTEL_EXPORTER_OTLP_ENDPOINT")).toBe(true);
    expect(isTelemetryVar("OTEL_METRICS_EXPORTER")).toBe(true);
    expect(isTelemetryVar("PATH")).toBe(false);
    expect(isTelemetryVar("CLAUDE_CONFIG_DIR")).toBe(false);
    expect(isTelemetryVar("MY_OTEL_NOTE")).toBe(false);
  });

  test("scrubbing removes them from the environment and returns the names that were set", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/bin",
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://x",
      CLAUDE_CONFIG_DIR: "/keep",
    };
    expect(scrubTelemetryEnv(env).sort()).toEqual([
      "CLAUDE_CODE_ENABLE_TELEMETRY",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_LOGS_EXPORTER",
    ]);
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/keep" });
    expect(scrubTelemetryEnv(env)).toEqual([]);
  });

  test("the guard strips them from the process and from what a spawned child inherits", () => {
    const saved = { ...process.env };
    process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
    process.env.OTEL_TEST_VAR = "leak";
    const spawn = Bun.spawn;
    const spawnSync = Bun.spawnSync;
    try {
      expect(installGitEnvGuard().removed).toEqual(
        expect.arrayContaining(["CLAUDE_CODE_ENABLE_TELEMETRY", "OTEL_TEST_VAR"]),
      );
      expect(process.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBeUndefined();
      const child = Bun.spawnSync(["env"], { stdout: "pipe" });
      const printed = child.stdout.toString();
      expect(printed).not.toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
      expect(printed).not.toContain("OTEL_TEST_VAR");
    } finally {
      Object.assign(Bun, { spawn, spawnSync });
      for (const name of ["CLAUDE_CODE_ENABLE_TELEMETRY", "OTEL_TEST_VAR"]) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
