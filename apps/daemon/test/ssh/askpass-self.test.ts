import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../../src/main.ts";
import { daemonCommand } from "../../src/service/index.ts";
import { tempDir } from "../support/helpers.ts";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** The askpass helper a daemon wrote at boot, the one ssh runs to ask for a password (#3989). */
async function helperOf(options: Parameters<typeof startDaemon>[3]) {
  const dir = tempDir("fd-askpass-self-");
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      hostName: "h",
      port: 0,
      token: "askpass-self-token-0123456789",
      dataDir: join(dir, "data"),
      allowedRoots: [dir],
    }),
  );
  const daemon = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    options,
  );
  stops.push(() => daemon.stop());
  return readFileSync(
    join(dir, "data", "ssh", process.platform === "win32" ? "askpass.cmd" : "askpass.sh"),
    "utf8",
  );
}

describe("the askpass helper calls back the command the daemon was started with (#3989)", () => {
  test("a daemon given its own command (the demo runs it inside another program) writes a helper that calls that command", async () => {
    const text = await helperOf({ self: ["/opt/fd/bun", "/opt/fd/main.ts"] });
    expect(text.includes("/opt/fd/bun") && text.includes("/opt/fd/main.ts")).toBe(true);
  });

  test("an installed daemon, given nothing, calls back the program it runs as", async () => {
    const text = await helperOf({});
    const [program] = daemonCommand(process.execPath, Bun.main);
    expect([text.includes(String(program)), text.includes("askpass")]).toEqual([true, true]);
  });

  test("the given command is not taken from anywhere else: an environment value changes nothing", async () => {
    const before = process.env.FLIGHTDECK_SELF;
    process.env.FLIGHTDECK_SELF = "/evil/helper";
    try {
      const text = await helperOf({});
      expect(text.includes("/evil/helper")).toBe(false);
    } finally {
      if (before === undefined) delete process.env.FLIGHTDECK_SELF;
      else process.env.FLIGHTDECK_SELF = before;
    }
  });
});
