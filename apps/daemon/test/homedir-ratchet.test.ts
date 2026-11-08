import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// repo-wide (#1108): reads every tracked daemon source file, so CI's quick job runs it on every PR.

/**
 * #258: Bun keeps, on Linux, the HOME the process started with for `os.homedir()`, so the
 * preload's fake HOME never reaches it and a test through `startDaemon` would read the real home
 * (shell history, `~/.ssh/config`). The daemon asks `userHome()` (config.ts, the environment
 * first); only config.ts itself may fall back to `homedir()`.
 */
const ROOT = resolve(import.meta.dir, "../../..");
const ALLOWED = "apps/daemon/src/config.ts";

/** Each `homedir` import from node:os and each `homedir()` call, as `file:line`. */
function homedirUses(path: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      /\bhomedir\s*\(|\{[^}]*\bhomedir\b[^}]*\}\s*from\s*["'](?:node:)?os["']/.test(line)
        ? [`${path}:${index + 1}`]
        : [],
    );
}

describe("homedir-ratchet (#258)", () => {
  test("the scan finds a homedir import and call, and leaves userHome alone", () => {
    const text = [
      'import { homedir, tmpdir } from "node:os";',
      "const a = homedir();",
      "const b = os.homedir();",
      "const c = userHome(env);",
    ].join("\n");
    expect(homedirUses("x.ts", text)).toEqual(["x.ts:1", "x.ts:2", "x.ts:3"]);
  });

  test("no daemon source outside config.ts reads the home through os.homedir()", () => {
    const sources = Bun.spawnSync(["git", "ls-files", "apps/daemon/src"], {
      cwd: ROOT,
      stdout: "pipe",
    })
      .stdout.toString()
      .split("\n")
      .filter((path) => /\.tsx?$/.test(path) && path !== ALLOWED);
    expect(sources.length).toBeGreaterThan(100);
    const found = sources.flatMap((path) =>
      homedirUses(path, readFileSync(resolve(ROOT, path), "utf8")),
    );
    expect(found).toEqual([]);
  });
});
