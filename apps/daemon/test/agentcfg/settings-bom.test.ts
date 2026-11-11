import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpConfig } from "../src/agentcfg/mcp.ts";
import { addRules, readRules } from "../src/board/project-rules.ts";
import {
  type HookTarget,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from "../src/central/hooks-install.ts";
import { layoutLike, parseJsonText } from "../src/json-text.ts";
import {
  installTelemetry,
  type TelemetryTarget,
  telemetryStatus,
  uninstallTelemetry,
} from "../src/telemetry/otlp-env.ts";
import { claudeSettingsEnv } from "../src/terminal/claude-settings-env.ts";
import { inspectProject } from "../src/trust/inspect.ts";
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

/** A project whose `.claude/<name>` is a Windows file holding `value`. */
function windowsProject(name: string, value: unknown, extra: Record<string, string> = {}): string {
  const root = tempDir("fd-settings-bom-project-");
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", name),
    `${BOM}${JSON.stringify(value, null, 4).replaceAll("\n", "\r\n")}\r\n`,
  );
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(root, file), text);
  return root;
}

const keepsLayout = (text: string) => text.startsWith(BOM) && text.includes('\r\n    "');

describe("settings-bom: the other readers of a project's Claude Code settings (review of #1029)", () => {
  test("the installs' status and uninstall read a Windows file as installed, and keep its layout", async () => {
    const hooks = windowsFile({ model: "opus" });
    const telemetry = windowsFile({ model: "opus" });
    await installHooks(hooks, HOOKS);
    await installTelemetry(telemetry, TELEMETRY);
    const before = [await hooksStatus(hooks, HOOKS), await telemetryStatus(telemetry, TELEMETRY)];
    const removed = [await uninstallHooks(hooks), await uninstallTelemetry(telemetry)];
    expect([
      before,
      removed,
      keepsLayout(readFileSync(hooks, "utf8")),
      keepsLayout(readFileSync(telemetry, "utf8")),
    ]).toEqual([["installed", "installed"], [true, true], true, true]);
  });

  test("project rules read and add to a Windows settings.local.json, in its layout", async () => {
    const root = windowsProject("settings.local.json", { permissions: { allow: ["Bash(ls)"] } });
    const read = await readRules(root).catch((error: unknown) => String(error));
    await addRules(root, ["Bash(bun test:*)"]).catch(() => undefined);
    const text = readFileSync(join(root, ".claude", "settings.local.json"), "utf8");
    expect([read, keepsLayout(text), text.includes("bun test")]).toEqual([
      ["Bash(ls)"],
      true,
      true,
    ]);
  });

  test("turning an MCP server off reads a Windows settings.local.json, in its layout", async () => {
    const root = windowsProject(
      "settings.local.json",
      { model: "opus" },
      { ".mcp.json": JSON.stringify({ mcpServers: { docs: { command: "docs-mcp" } } }) },
    );
    const done = await new McpConfig({ userConfigPath: join(root, "user.json") })
      .toggle(root, "docs", false, true)
      .then(
        () => "ok",
        (error: unknown) => String(error),
      );
    const text = readFileSync(join(root, ".claude", "settings.local.json"), "utf8");
    expect([done, keepsLayout(text), text.includes("docs")]).toEqual(["ok", true, true]);
  });

  test("the trust inspection reads a Windows settings.json instead of calling it unreadable", async () => {
    const root = windowsProject("settings.json", {
      hooks: {
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "biome format" }] }],
      },
    });
    const load = await inspectProject(root);
    expect([load.unreadable, load.hooks.length]).toEqual([[], 1]);
  });
});

describe("json-text: parse past a BOM, write in the file's layout", () => {
  test("each layout comes back as it was: tabs, no final newline, LF, a new file", () => {
    const value = { a: 1 };
    const layouts = [`{\n\t"a": 0\n}\n`, `{\n  "a": 0\n}`, `${BOM}{\r\n  "a": 0\r\n}\r\n`];
    expect([
      ...layouts.map((text) => layoutLike(text, value) === text.replace("0", "1")),
      layoutLike(null, value),
      parseJsonText(`${BOM}{"a":1}`),
    ]).toEqual([true, true, true, '{\n  "a": 1\n}\n', { a: 1 }]);
  });
});
