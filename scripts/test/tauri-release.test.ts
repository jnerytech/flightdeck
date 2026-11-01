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

  test("the only panic recovery is tokio's JoinError in the key generator, and that code cannot panic", () => {
    const source = readFileSync(join(ROOT, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
    expect(source).not.toContain("catch_unwind");
    // `spawn_blocking` turns a panic into an error string for the UI; `abort` would end the app
    // instead. `generate_key` has no path that panics: a second use needs the same review.
    expect(source.match(/spawn_blocking/g)).toHaveLength(1);
  });

  test("plugin commands no capability allows are left out of the build (removeUnusedCommands)", () => {
    expect(conf.build?.removeUnusedCommands).toBe(true);
  });
});
