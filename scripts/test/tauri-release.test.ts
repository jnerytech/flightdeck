import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const cargo = Bun.TOML.parse(
  readFileSync(join(ROOT, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
) as { profile?: { release?: Record<string, unknown> } };

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

  test("nothing in the Rust code catches a panic, so aborting on one changes no behaviour", () => {
    const source = readFileSync(join(ROOT, "apps/desktop/src-tauri/src/lib.rs"), "utf8");
    expect(source).not.toContain("catch_unwind");
  });
});
