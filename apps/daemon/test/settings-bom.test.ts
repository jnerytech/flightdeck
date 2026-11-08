import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type HookTarget, installHooks } from "../src/central/hooks-install.ts";
import { installTelemetry, type TelemetryTarget } from "../src/telemetry/otlp-env.ts";
import { claudeSettingsEnv } from "../src/terminal/claude-settings-env.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #1014: a settings.json that a Windows editor saved with a UTF-8 BOM (and CRLF) is read by
 * every reader of the file, as the harness preview reads it (#927), and keeps both when written back.
 */
const BOM = "\uFEFF";
const HOOKS: HookTarget = {
  command: ["/opt/flightdeck/flightdeckd"],
  url: "http://127.0.0.1:7421",
  token: "tok-0123456789",
  permissionTimeoutS: 600,
};
const TELEMETRY: TelemetryTarget = { url: "http://127.0.0.1:7422", token: "tel-0123456789abcdef" };

/** A Windows settings.json: BOM, CRLF and 4 spaces. */
function windowsFile(value: unknown): string {
  const file = join(tempDir("fd-settings-bom-"), "settings.json");
  writeFileSync(file, `${BOM}${JSON.stringify(value, null, 4).replaceAll("\n", "\r\n")}\r\n`);
  return file;
}

const parsed = (text: string) => JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);

describe("settings-bom: every reader of settings.json reads past a BOM and keeps the file's layout (#1014)", () => {
  test("the terminal's env defaults read the env block", async () => {
    const file = windowsFile({ env: { CLAUDE_CODE_SCROLL_SPEED: "5" } });
    expect(await claudeSettingsEnv(file)).toEqual({ CLAUDE_CODE_SCROLL_SPEED: "5" });
  });

  test("installing the hooks keeps the person's keys, the BOM, CRLF and the indent", async () => {
    const file = windowsFile({ model: "opus" });
    const done = await installHooks(file, HOOKS).then(
      () => "ok",
      (error: unknown) => String(error),
    );
    const text = readFileSync(file, "utf8");
    expect([
      done,
      text.startsWith(BOM),
      text.includes('\r\n    "model"'),
      parsed(text).model,
      Object.keys(parsed(text).hooks ?? {}).length > 0,
    ]).toEqual(["ok", true, true, "opus", true]);
  });

  test("turning telemetry on keeps the person's keys, the BOM, CRLF and the indent", async () => {
    const file = windowsFile({ model: "opus" });
    const done = await installTelemetry(file, TELEMETRY).then(
      (result) => result.ok,
      (error: unknown) => String(error),
    );
    const text = readFileSync(file, "utf8");
    expect([
      done,
      text.startsWith(BOM),
      text.includes('\r\n    "model"'),
      parsed(text).model,
      typeof parsed(text).env,
    ]).toEqual([true, true, true, "opus", "object"]);
  });
});
