import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join, sep } from "node:path";
import { claudeCli } from "../../../apps/daemon/src/plugins/adapters/claude-plugin.ts";
import { Plugins } from "../../../apps/daemon/src/plugins/plugins.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { type DemoPluginFiles, writeDemoPlugins } from "../../lib/demo/plugins.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { agentShots } from "../../lib/shots/table-agent.ts";
import { installFakeCli } from "../fake-cli.ts";
import { realTempDir } from "../temp-dir.ts";

const IDS = { refusedPluginFolder: "/work/plugins/broken" } as DemoIds;
const pluginShots = () => agentShots(IDS).filter((shot) => shot.name.startsWith("plugins"));

/** The value, or what failed as `{ failed }`, so a missing answer is a red by assertion. */
const settle = async <T>(call: () => Promise<T>): Promise<T | { failed: string }> =>
  call().catch((error: unknown) => ({ failed: String(error) }));

const work = realTempDir("fd-demo-plugins-");
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A plugin manager over the demo's folders and its fake `claude`. */
async function demoManager(): Promise<{
  plugins: Plugins;
  files: DemoPluginFiles;
  stop: () => void;
}> {
  const files = writeDemoPlugins(work);
  const fake = installFakeCli("claude", files.rules);
  const plugins = new Plugins({
    cli: claudeCli(),
    pins: { all: async () => ({}), set: async () => {}, delete: async () => {} },
  });
  return { plugins, files, stop: () => fake.restore() };
}

describe("the Plugins prints (#3956)", () => {
  test("the table prints the Installed tab and then each screen where a person lets code run", () => {
    expect(pluginShots().map((shot) => shot.name)).toEqual([
      "plugins",
      "plugins-disponiveis",
      "plugins-marketplaces",
      "plugins-conteudo",
      "plugins-instalar",
      "plugins-atualizar",
      "plugins-pasta-recusada",
    ]);
    expect(pluginShots().every((shot) => shot.route.name === "plugins")).toBe(true);
  });

  test("the Installed tab is re-measured narrow in the dark prints, for its long-named plugin", () => {
    expect(narrowSizes("dark", "plugins").map((size) => size.width)).toEqual([1024, 640, 390]);
    expect(narrowSizes("light", "plugins")).toEqual([]);
  });
});

describe("the demo's plugin folders feed each dialog (#3956)", () => {
  test("the folder the print previews is inside alfa's allowed folder, or the daemon refuses it and the dialog never loads", () => {
    const { refusedFolder } = writeDemoPlugins(work);
    expect(refusedFolder.startsWith(join(work, "alfa", "projects") + sep)).toBe(true);
  });

  test("the host lists a plugin with a long name next to deploy-tools, and lint-rules as available", async () => {
    const { plugins, stop } = await demoManager();
    try {
      const listed = await settle(() => plugins.list());
      const names = "installed" in listed ? listed.installed.map((one) => one.name) : [];
      expect(names).toContain("deploy-tools");
      expect(names.some((name) => name.length >= 40)).toBe(true);
      expect("available" in listed && listed.available.map((one) => one.id)).toEqual([
        "lint-rules@acme",
      ]);
    } finally {
      stop();
    }
  });

  test("the install dialog of lint-rules has a content hash to confirm", async () => {
    const { plugins, stop } = await demoManager();
    try {
      const shown = await settle(() => plugins.preview({ plugin: "lint-rules@acme" }));
      expect("hash" in shown && typeof shown.hash).toBe("string");
      expect(("inventory" in shown && shown.inventory?.hooks.length) || 0).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  test("the update dialog of deploy-tools goes from 1.2.0 to a newer version with something changed", async () => {
    const { plugins, stop } = await demoManager();
    try {
      const shown = await settle(() => plugins.previewUpdate("deploy-tools@acme"));
      expect("from" in shown && shown.from.version).toBe("1.2.0");
      expect("to" in shown && shown.to.version).toBe("1.3.0");
      expect("unchanged" in shown && shown.unchanged).toBe(false);
    } finally {
      stop();
    }
  });

  test("the folder the validation refuses names its errors", async () => {
    const { plugins, files, stop } = await demoManager();
    try {
      const shown = await settle(() => plugins.preview({ dir: files.refusedFolder }));
      expect("validation" in shown && shown.validation?.success).toBe(false);
      expect(("validation" in shown && shown.validation?.errors.length) || 0).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });
});
