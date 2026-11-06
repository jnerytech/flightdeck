import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { cliCalls, GUARDED_CLIS, installCliGuard } from "./cli-guard.ts";
import { scrubOpenCodeEnv } from "./opencode-env-guard.ts";
import { realTempDir } from "./temp-dir.ts";

// Phase 39: no test may run the real `opencode` (its server, its sessions, its credentials).
describe("opencode-guard", () => {
  test("opencode is one of the guarded CLIs", () => {
    expect(GUARDED_CLIS as readonly string[]).toContain("opencode");
  });

  test("in this run, a lookup of opencode on PATH lands on a sentinel of the preload", () => {
    const found = Bun.which("opencode", { PATH: process.env.PATH ?? "" }) ?? "";
    expect(basename(dirname(found)).startsWith("fd-cli-guard-")).toBe(true);
  });

  test.skipIf(process.platform === "win32")(
    "a folder with a real opencode leaves PATH, and the sentinel records the call and exits 99",
    () => {
      const realBin = realTempDir("fd-opencode-bin-");
      writeFileSync(join(realBin, "opencode"), "#!/bin/sh\necho real\n");
      chmodSync(join(realBin, "opencode"), 0o755);
      const env: Record<string, string | undefined> = { PATH: realBin };
      const guard = installCliGuard(GUARDED_CLIS, env);
      const path = env.PATH ?? "";
      expect(path.split(delimiter)).not.toContain(realBin);
      const sentinel = Bun.which("opencode", { PATH: path }) ?? "";
      expect(sentinel).toBe(join(guard.dir, "opencode"));
      const run = Bun.spawnSync([sentinel, "acp"], { env: { PATH: path } });
      expect(run.exitCode).toBe(99);
      expect(cliCalls(guard)).toEqual(["opencode acp"]);
    },
  );

  test("the sentinel has a .cmd twin for Windows", () => {
    const guard = installCliGuard(GUARDED_CLIS, { PATH: "" });
    const cmd = join(guard.dir, "opencode.cmd");
    expect(existsSync(cmd)).toBe(true);
    expect(existsSync(cmd) ? readFileSync(cmd, "utf8") : "").toContain("exit /b 99");
  });

  test("the OPENCODE_* variables and the XDG folders are scrubbed, and none is left in this run", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/bin",
      OPENCODE_CONFIG: "/x",
      opencode_db: "/y",
      XDG_CONFIG_HOME: "/c",
      XDG_DATA_HOME: "/d",
      XDG_STATE_HOME: "/s",
      XDG_CACHE_HOME: "/k",
      XDG_RUNTIME_DIR: "/run/user/1",
    };
    scrubOpenCodeEnv(env);
    expect(env).toEqual({ PATH: "/bin", XDG_RUNTIME_DIR: "/run/user/1" });
    const left = Object.keys(process.env).filter(
      (key) => /^OPENCODE_/i.test(key) || /^XDG_(CONFIG|DATA|STATE|CACHE)_HOME$/.test(key),
    );
    expect(left).toEqual([]);
  });
});
