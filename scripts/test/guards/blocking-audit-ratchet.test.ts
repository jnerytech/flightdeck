import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  ASYNC_INLINE_ALLOWED,
  asyncCommandsInline,
  SYNC_COMMANDS_ALLOWED,
  syncTauriCommands,
} from "../../lib/ratchets/blocking-audit.ts";

const root = resolve(import.meta.dir, "../../..");
const daemonSrc = join(root, "apps/daemon/src");
const tauriSrc = join(root, "apps/desktop/src-tauri/src");

/**
 * The Rust sources whose commands the audit covers: lib.rs and the modules moved out of it (#1589).
 * assistant.rs, backup_folder.rs and oauth_loopback.rs are not audited yet: their commands need an
 * allowlist decision of their own.
 */
const AUDITED_SOURCES = ["lib.rs", "log.rs", "open_result.rs", "vault.rs"];

function tauriSources(): string {
  return AUDITED_SOURCES.map((file) => readFileSync(join(tauriSrc, file), "utf8")).join("\n");
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("blocking-audit: the app's hot paths do not block", () => {
  test("lists the commands that are not async", () => {
    const rust = [
      "#[tauri::command]",
      "fn plain(a: String) -> Result<(), String> {",
      "#[tauri::command]",
      "async fn later() {}",
      '#[tauri::command(rename_all = "snake_case")]',
      "fn multi(",
      "    a: u8,",
      ") {}",
      "fn helper() {}",
    ].join("\n");
    expect(syncTauriCommands(rust)).toEqual(["plain", "multi"]);
    expect(syncTauriCommands("")).toEqual([]);
  });

  test("a Tauri command is async unless it needs the main thread (tray, window)", () => {
    const rust = tauriSources();
    expect(syncTauriCommands(rust).sort()).toEqual([...SYNC_COMMANDS_ALLOWED].sort());
  });

  test("finds the async commands that do their blocking work inline", () => {
    const rust = [
      "#[tauri::command]",
      "async fn inline(a: String) -> Result<(), String> {",
      "    entry(&a).get_password()",
      "}",
      "",
      "#[tauri::command]",
      "async fn offloaded(a: String) -> Result<(), String> {",
      "    tauri::async_runtime::spawn_blocking(move || work(a)).await.map_err(|e| e.to_string())?",
      "}",
      "",
      "#[tauri::command]",
      "fn plain() {}",
    ].join("\n");
    expect(asyncCommandsInline(rust)).toEqual(["inline"]);
  });

  test("a `pub` command is audited like any other", () => {
    const rust = [
      "#[tauri::command]",
      "pub fn plain() {}",
      "#[tauri::command]",
      "pub(crate) async fn inline(a: String) -> Result<(), String> {",
      "    entry(&a).get_password()",
      "}",
      "",
    ].join("\n");
    expect(syncTauriCommands(rust)).toEqual(["plain"]);
    expect(asyncCommandsInline(rust)).toEqual(["inline"]);
  });

  test("an async Tauri command moves its blocking work to `spawn_blocking`", () => {
    const rust = tauriSources();
    expect(asyncCommandsInline(rust).sort()).toEqual([...ASYNC_INLINE_ALLOWED].sort());
  });
});
