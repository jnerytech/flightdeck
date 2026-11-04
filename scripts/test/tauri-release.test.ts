import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const cargo = Bun.TOML.parse(
  readFileSync(join(ROOT, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
) as { profile?: { release?: Record<string, unknown> } };

const conf = JSON.parse(
  readFileSync(join(ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { build?: Record<string, unknown> };

describe("tauri-release: the release build of the app is made for size and speed", () => {
  test("Cargo.toml has a release profile with one codegen unit, LTO, size optimisation, stripped symbols and abort on panic", () => {
    expect(cargo.profile?.release).toEqual({
      "codegen-units": 1,
      lto: true,
      "opt-level": "s",
      panic: "abort",
      strip: true,
    });
  });

  test("the only panic recovery is tokio's JoinError on the blocking pool, and the code on it cannot panic", () => {
    const source = readFileSync(join(ROOT, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
    expect(source).not.toContain("catch_unwind");
    // `spawn_blocking` turns a panic into an error string for the UI; `abort` would end the app
    // instead. Blocking work goes through `spawn_blocking_result`, which maps the JoinError to an
    // error string; the only direct uses are that helper, the key generator and the terminal probe
    // (which reads a lost join as "no Windows Terminal"). A fourth direct use needs the same review.
    expect(source.match(/async_runtime::spawn_blocking\(/g)).toHaveLength(3);
    expect(source).toContain(".map_err(|e| e.to_string())?");
  });

  test("plugin commands no capability allows are left out of the build (removeUnusedCommands)", () => {
    expect(conf.build?.removeUnusedCommands).toBe(true);
  });
});
