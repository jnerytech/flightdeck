import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../support/helpers.ts";

const BIN = join(import.meta.dir, "../../src/bin.ts");

/** Lists the daemon's source files a run of bin.ts loaded, as paths under `apps/daemon/src/`. */
const PROBE = `process.on("exit", () => {
  const loaded = Object.keys(require.cache)
    .filter((key) => key.includes("/apps/daemon/src/"))
    .map((key) => key.split("/apps/daemon/src/")[1]);
  console.error("LOADED " + JSON.stringify(loaded));
});`;

async function loadedBy(args: string[]): Promise<{ code: number; loaded: string[] }> {
  const dir = tempDir("fd-startup-");
  const probe = join(dir, "probe.ts");
  writeFileSync(probe, PROBE);
  const child = Bun.spawn(
    [process.execPath, "--preload", probe, BIN, ...args, "--config", join(dir, "none.json")],
    {
      cwd: dir,
      env: { ...process.env, HOME: dir },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  const line = err.split("\n").find((l) => l.startsWith("LOADED "));
  return { code, loaded: line ? JSON.parse(line.slice("LOADED ".length)) : [] };
}

describe("cli-startup", () => {
  test("flightdeckd statusline starts without loading the daemon", async () => {
    const { code, loaded } = await loadedBy(["statusline"]);
    expect(code).toBe(0);
    expect(loaded.includes("costs/statusline.ts")).toBe(true);
    // Booleans: a failed diff of the whole list of loaded files is too long to read.
    expect(loaded.includes("main.ts")).toBe(false);
    expect(loaded.some((file) => file.startsWith("server/"))).toBe(false);
  });

  test("flightdeckd hook session-start starts without the daemon and the messaging service", async () => {
    const { code, loaded } = await loadedBy([
      "hook",
      "session-start",
      "--url",
      "ws://127.0.0.1:1",
      "--token",
      "t",
    ]);
    expect(code).toBe(0);
    expect(loaded.includes("central/hook-command.ts")).toBe(true);
    expect(loaded.includes("main.ts")).toBe(false);
    expect(loaded.some((file) => file.startsWith("messaging/"))).toBe(false);
  });
});
