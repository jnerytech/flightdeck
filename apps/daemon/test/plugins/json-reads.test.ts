import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FlightdeckError } from "../../src/kernel/errors.ts";
import { inspectPlugin } from "../../src/plugins/inventory.ts";
import { filePins, type PluginCli, Plugins } from "../../src/plugins/plugins.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(30_000);

const BOM = "﻿";

/** A plugin folder with the given files (path to text). */
function plugin(files: Record<string, string>): string {
  const dir = join(tempDir("fd-plugin-json-"), "p");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("plugins: JSON the plugin and the CLI hand over (#1609)", () => {
  test("a manifest and a hooks file saved with a byte order mark are read, not reported as broken", async () => {
    const inventory = await inspectPlugin(
      plugin({
        ".claude-plugin/plugin.json": `${BOM}${JSON.stringify({ name: "deploy-tools", version: "1.0.0" })}`,
        "hooks/hooks.json": `${BOM}${JSON.stringify({
          hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo ok" }] }] },
        })}`,
      }),
    );
    expect(inventory.problems).toEqual([]);
    expect(inventory.manifest?.name).toBe("deploy-tools");
    expect(inventory.hooks.map((hook) => hook.command)).toEqual(["echo ok"]);
  });

  test("a validate that answers JSON but not an object is no answer", async () => {
    const dir = plugin({ ".claude-plugin/plugin.json": JSON.stringify({ name: "p" }) });
    const cli: PluginCli = {
      run: async () => ({ code: 0, stdout: "[1, 2]", stderr: "" }),
    };
    const plugins = new Plugins({
      cli,
      pins: { all: async () => ({}), set: async () => {}, delete: async () => {} },
    });
    const hash = (await inspectPlugin(dir)).hash;
    let refusal: FlightdeckError | undefined;
    try {
      await plugins.install({ dir, confirmHash: hash });
    } catch (error) {
      refusal = error as FlightdeckError;
    }
    expect(refusal?.reason).toBe("plugin_validate_refused");
    expect(refusal?.params).toEqual({ errors: "validate did not answer" });
  });

  test("a pin that lost fields reads with them empty, and a pin that is no object stays a pin", async () => {
    const file = join(tempDir("fd-pins-json-"), "plugin-pins.json");
    writeFileSync(file, JSON.stringify({ "a@m": { version: "1" }, "b@m": "junk" }));
    const pins = await filePins(file).all();
    // A key in the file is a pin that blocks an update: it must not vanish when it is malformed.
    expect(Object.keys(pins).sort()).toEqual(["a@m", "b@m"]);
    expect(pins["a@m"]).toEqual({ version: "1", hash: "", at: "" });
    expect(pins["b@m"]).toEqual({ version: "", hash: "", at: "" });
  });

  test("a pin with one wrong-typed field keeps the others, so writing the file back loses nothing", async () => {
    const file = join(tempDir("fd-pins-json-"), "plugin-pins.json");
    writeFileSync(file, JSON.stringify({ "a@m": { version: 5, hash: "h", at: "t" } }));
    expect((await filePins(file).all())["a@m"]).toEqual({ version: "", hash: "h", at: "t" });
  });

  test("a pins file that is a list, or not JSON, holds no pin", async () => {
    const file = join(tempDir("fd-pins-json-"), "plugin-pins.json");
    writeFileSync(file, "[1]");
    expect(await filePins(file).all()).toEqual({});
    writeFileSync(file, "not json");
    expect(await filePins(file).all()).toEqual({});
  });
});

describe("plugins: pin changes in a row", () => {
  test("two plugin pin changes in a row: a failed one does not stop the next", async () => {
    const dir = tempDir("fd-pins-");
    const path = join(dir, "pins.json");
    mkdirSync(path);
    const pins = filePins(path);
    await expect(
      pins.set("a@b", { hash: "h1", at: "2026-11-03T10:00:00Z" } as never),
    ).rejects.toThrow();
    rmSync(path, { recursive: true });
    await pins.set("a@b", { hash: "h2", at: "2026-11-03T10:00:00Z" } as never);
    expect(JSON.parse(readFileSync(path, "utf8"))["a@b"].hash).toBe("h2");
  });
});
