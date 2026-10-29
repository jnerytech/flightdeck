import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HookTarget,
  HTTP_HOOK_EVENTS,
  hookEntries,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from "../src/central/hooks-install.ts";
import { expandHome, loadConfig } from "../src/config.ts";
import { runCli } from "../src/main.ts";
import { tempDir } from "./helpers.ts";

const TARGET: HookTarget = {
  command: ["C:\\Program Files\\flightdeck\\flightdeckd.exe"],
  url: "http://127.0.0.1:7421",
  token: "tok-0123456789",
  permissionTimeoutS: 600,
};

/** A user's settings with other keys and third-party hooks on the same events. */
const ORIGINAL = {
  model: "opus",
  permissions: { allow: ["Bash(ls:*)"] },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "notify-send pronto" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }],
  },
};

function settingsFile(content?: unknown): string {
  const dir = join(tempDir(), ".claude");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.json");
  if (content !== undefined) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return file;
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("hooks-install", () => {
  test("entradas: SessionStart por comando com o caminho absoluto, os outros http com token", () => {
    const entries = hookEntries(TARGET);
    expect(Object.keys(entries).sort()).toEqual(["SessionStart", ...HTTP_HOOK_EVENTS].sort());
    expect(entries.SessionStart).toEqual([
      {
        hooks: [
          {
            type: "command",
            command:
              '"C:\\Program Files\\flightdeck\\flightdeckd.exe" hook session-start --url http://127.0.0.1:7421 --token tok-0123456789',
            timeout: 5,
          },
        ],
      },
    ]);
    expect(entries.Stop).toEqual([
      {
        hooks: [
          {
            type: "http",
            url: "http://127.0.0.1:7421/hooks/Stop",
            headers: { Authorization: "Bearer tok-0123456789" },
            timeout: 5,
          },
        ],
      },
    ]);
    expect(entries.PermissionRequest?.[0]?.hooks[0]?.timeout).toBe(600);
    const dev = hookEntries({ ...TARGET, command: ["C:\\bun\\bun.exe", "D:\\fd\\bin.ts"] });
    expect(
      dev.SessionStart?.[0]?.hooks[0]?.command?.startsWith("C:\\bun\\bun.exe D:\\fd\\bin.ts hook"),
    ).toBe(true);
  });

  test("mescla no settings.json existente sem perder chaves nem hooks de terceiros, com backup", () => {
    const file = settingsFile(ORIGINAL);
    const before = readFileSync(file, "utf8");
    installHooks(file, TARGET);
    expect(existsSync(`${file}.flightdeck-backup`)).toBe(true);
    const after = read(file);
    expect(after.model).toBe("opus");
    expect(after.permissions).toEqual(ORIGINAL.permissions);
    expect(after.hooks.PreToolUse).toEqual(ORIGINAL.hooks.PreToolUse);
    expect(after.hooks.Stop).toEqual([...ORIGINAL.hooks.Stop, ...(hookEntries(TARGET).Stop ?? [])]);
    expect(after.hooks.SessionEnd).toEqual(hookEntries(TARGET).SessionEnd);
    expect(readFileSync(`${file}.flightdeck-backup`, "utf8")).toBe(before);
  });

  test("reinstalar não duplica", () => {
    const file = settingsFile(ORIGINAL);
    installHooks(file, TARGET);
    const once = read(file);
    installHooks(file, TARGET);
    expect(read(file)).toEqual(once);
    installHooks(file, { ...TARGET, url: "http://127.0.0.1:9999" });
    expect(read(file).hooks.Stop).toHaveLength(2);
    expect(read(file).hooks.Stop[1].hooks[0].url).toBe("http://127.0.0.1:9999/hooks/Stop");
  });

  test("uninstall remove só as entradas do Flightdeck e devolve o settings.json original", () => {
    const file = settingsFile(ORIGINAL);
    installHooks(file, TARGET);
    expect(uninstallHooks(file)).toBe(true);
    expect(read(file)).toEqual(ORIGINAL);
    expect(uninstallHooks(file)).toBe(false);
  });

  test("sem settings.json: install cria, sem backup; uninstall deixa um objeto vazio", () => {
    const file = settingsFile();
    installHooks(file, TARGET);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.flightdeck-backup`)).toBe(false);
    expect(Object.keys(read(file).hooks)).toHaveLength(9);
    uninstallHooks(file);
    expect(read(file)).toEqual({});
    rmSync(file);
    expect(uninstallHooks(file)).toBe(false);
  });

  test("status: ausente, instalado e desatualizado", () => {
    const file = settingsFile(ORIGINAL);
    expect(hooksStatus(file, TARGET)).toBe("absent");
    installHooks(file, TARGET);
    expect(hooksStatus(file, TARGET)).toBe("installed");
    expect(hooksStatus(file, { ...TARGET, permissionTimeoutS: 60 })).toBe("outdated");
    expect(hooksStatus(file, { ...TARGET, command: ["/outro/flightdeckd"] })).toBe("outdated");
    const partial = read(file);
    delete partial.hooks.SessionEnd;
    writeFileSync(file, JSON.stringify(partial));
    expect(hooksStatus(file, TARGET)).toBe("outdated");
    expect(hooksStatus(join(tempDir(), "nao-existe.json"), TARGET)).toBe("absent");
  });
});

describe("hooks-install: CLI", () => {
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
      JSON.stringify({ token: "t".repeat(32), dataDir: join(tempDir(), "d"), ...extra }),
    );
    return file;
  }

  test("install, status e uninstall no ~/.claude do HOME temporário, com hooks.token gerado", async () => {
    const settings = expandHome("~/.claude/settings.json");
    rmSync(settings, { force: true });
    const file = config();
    await runCli(["hooks", "install", "--config", file], deps);
    expect(exitCode).toBe(0);
    const token = loadConfig(file).hooks.token ?? "";
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(read(settings).hooks.Stop[0].hooks[0]).toEqual({
      type: "http",
      url: "http://127.0.0.1:7421/hooks/Stop",
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5,
    });
    await runCli(["hooks", "status", "--config", file], deps);
    expect(out.join("\n")).toContain("hooks: instalados");
    await runCli(["hooks", "install", "--config", file], deps);
    expect(loadConfig(file).hooks.token).toBe(token);
    await runCli(["hooks", "uninstall", "--config", file], deps);
    expect(read(settings)).toEqual({});
    await runCli(["hooks", "status", "--config", file], deps);
    expect(out.join("\n")).toContain("hooks: ausentes");
  });

  test("hooks.port 0 é recusado: o receptor não teria endereço fixo", async () => {
    await runCli(["hooks", "install", "--config", config({ hooks: { port: 0 } })], deps);
    expect(exitCode).toBe(1);
    expect(out.join("\n")).toContain("hooks.port");
  });
});
