import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 40: a provider call leaves only through the Rust shell. The webview's CSP stays as it is
 * (no `https:`; the one addition is `media-src data:`, for the chosen notification sound, #149),
 * no app code reaches a provider host, no command hands a key back, the HTTP client has one TLS
 * provider, and the commands' blocking work goes through `spawn_blocking_result`.
 */
const ROOT = join(import.meta.dir, "../..");
const TAURI = join(ROOT, "apps/desktop/src-tauri");
const read = (path: string) => readFileSync(path, "utf8");

const CSP =
  "default-src 'self'; connect-src 'self' ws: wss: ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*";

const COMMANDS = [
  "token_get",
  "token_set",
  "token_delete",
  "vault_get",
  "vault_set",
  "vault_delete",
  "vault_generate_key",
  "vault_pick_file",
  "pick_folder",
  "backup_folder_pick",
  "backup_folder_current",
  "backup_folder_write",
  "backup_folder_list",
  "backup_folder_remove",
  "open_result",
  "append_log",
  "read_log_tail",
  "open_logs_dir",
  "vault_remove_file",
  "tray_set_status",
  "tray_set_menu",
  "set_unread_badge",
  "set_close_to_tray",
  "focus_main",
  "terminal_probe",
  "terminal_open",
  "quit_now",
  "assistant::assistant_key_set",
  "assistant::assistant_key_status",
  "assistant::assistant_key_delete",
  "assistant::assistant_test",
  "assistant::assistant_models",
  "assistant::assistant_run",
  "assistant::assistant_cancel",
  "assistant::vault_hits",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => join(dir, f));
}

describe("assistant-csp: a provider is reached only from Rust (phase 40)", () => {
  test("the CSP is the one before phase 40 plus media-src data:, and connect-src has no https:", () => {
    const conf = JSON.parse(read(join(TAURI, "tauri.conf.json")));
    const csp: string = conf.app.security.csp;
    expect(csp).toBe(CSP);
    const connect = csp.split(";").find((part) => part.trim().startsWith("connect-src")) ?? "";
    expect(connect).not.toContain("https:");
  });

  test("no app source calls fetch or XMLHttpRequest in a file that names a provider host", () => {
    const offenders = sourceFiles(join(ROOT, "apps/desktop/src")).filter((file) => {
      const text = read(file);
      const names = /api\.anthropic\.com|openrouter\.ai\/api/.test(text);
      return names && /\bfetch\(|XMLHttpRequest/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test("the platform has no way to read a key back", () => {
    const types = read(join(ROOT, "apps/desktop/src/platform/types.ts"));
    expect(types).not.toMatch(/\b(getKey|readKey|keyValue)\b/);
    const commands = read(join(TAURI, "src/lib.rs"));
    expect(commands).not.toMatch(/assistant_key_get|assistant_key_read/);
  });

  test("reqwest has the updater's three features and no default ones; no second TLS provider is locked", () => {
    const cargo = read(join(TAURI, "assistant/Cargo.toml"));
    expect(cargo).toContain(
      'reqwest = { version = "0.13", default-features = false, features = ["json", "rustls-no-provider", "system-proxy"] }',
    );
    expect(cargo).toContain(
      'rustls = { version = "0.23", default-features = false, features = ["ring"] }',
    );
    const lock = read(join(TAURI, "Cargo.lock"));
    for (const crate of ["native-tls", "aws-lc-rs", "aws-lc-sys"]) {
      expect(lock).not.toContain(`name = "${crate}"`);
    }
  });

  test("the registered commands are exactly the expected ones", () => {
    const lib = read(join(TAURI, "src/lib.rs"));
    const list = lib.match(/generate_handler!\[([^\]]*)\]/)?.[1] ?? "";
    const registered = list
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    expect(registered).toEqual(COMMANDS);
  });

  test("the assistant's commands do their blocking work through spawn_blocking_result only", () => {
    const path = join(TAURI, "src/assistant.rs");
    expect(existsSync(path)).toBe(true);
    const source = existsSync(path) ? read(path) : "";
    expect(source).not.toContain("spawn_blocking(");
    expect(source).toContain("spawn_blocking_result(");
    expect(read(join(TAURI, "src/lib.rs"))).toContain("pub(crate) async fn spawn_blocking_result");
  });
});
