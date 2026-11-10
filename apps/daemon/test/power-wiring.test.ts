import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PowerContext } from "../src/power/keep-awake.ts";
import { createKeepAwake } from "../src/power/wiring.ts";
import { tempDir } from "./helpers.ts";

/**
 * The keep-awake hold as main.ts builds it (issue #163, #1593): the client's switch writes the
 * config file before the config and the hold take it.
 */
const power: PowerContext = {
  platform: "linux",
  pid: 1,
  wsl: false,
  which: () => null,
  hold: () => null,
};

function wired(configFile: string) {
  const config = { keepAwake: true };
  return { built: createKeepAwake({ powerContext: power, config, configFile }), config };
}

describe("power-wiring: the host's hold on the computer and its switch (#1593)", () => {
  test("the switch writes the config file, then the config and the hold take it", async () => {
    const configFile = join(tempDir("fd-power-wiring-"), "config.json");
    writeFileSync(configFile, JSON.stringify({ port: 0 }));
    const { built, config } = wired(configFile);
    await built.keepAwakeSwitch.set(false);
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toEqual({ port: 0, keepAwake: false });
    expect(config.keepAwake).toBe(false);
    expect(built.keepAwakeSwitch.status().enabled).toBe(false);
  });

  test("a switch the config file cannot take leaves the config and the hold as they were", async () => {
    const { built, config } = wired(join(tempDir("fd-power-wiring-"), "missing", "config.json"));
    let failed = false;
    await built.keepAwakeSwitch.set(false).catch(() => {
      failed = true;
    });
    expect(failed).toBe(true);
    expect(config.keepAwake).toBe(true);
    expect(built.keepAwake.status().enabled).toBe(true);
  });
});
