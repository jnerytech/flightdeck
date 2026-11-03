import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  MAIN_KEY_FOR_ALLOWED,
  SPAWN_SYNC_ALLOWED,
  SYNC_COMMANDS_ALLOWED,
  syncTauriCommands,
} from "../lib/blocking-audit-ratchet.ts";

const root = resolve(import.meta.dir, "../..");
const daemonSrc = join(root, "apps/daemon/src");

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
      "#[tauri::command(rename_all = \"snake_case\")]",
      "fn multi(",
      "    a: u8,",
      ") {}",
      "fn helper() {}",
    ].join("\n");
    expect(syncTauriCommands(rust)).toEqual(["plain", "multi"]);
    expect(syncTauriCommands("")).toEqual([]);
  });

  test("a Tauri command is async unless it needs the main thread (tray, window)", () => {
    const rust = readFileSync(join(root, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
    expect(syncTauriCommands(rust).sort()).toEqual([...SYNC_COMMANDS_ALLOWED].sort());
  });

  test("the daemon blocks on `Bun.spawnSync` only where an async twin and a warm path exist", () => {
    const files = sources(daemonSrc)
      .filter((file) => readFileSync(file, "utf8").includes("Bun.spawnSync("))
      .map((file) => relative(daemonSrc, file).replaceAll("\\", "/"))
      .sort();
    expect(files).toEqual([...SPAWN_SYNC_ALLOWED].sort());
  });

  test("main.ts reads a project key synchronously only behind a warm", () => {
    const main = readFileSync(join(daemonSrc, "main.ts"), "utf8");
    expect([...main.matchAll(/\bkeys\.keyFor\(/g)].length).toBe(MAIN_KEY_FOR_ALLOWED);
  });
});
