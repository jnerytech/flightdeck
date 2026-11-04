import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { inspectPlugin } from "../src/plugins/inventory.ts";
import {
  type CliResult,
  claudeCli,
  type Pin,
  type PluginCli,
  Plugins,
} from "../src/plugins/plugins.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(30_000);

/** The code, reason and params of the refusal a call ends in. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params } = error as FlightdeckError;
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

type Answers = Record<string, Partial<CliResult>>;

/** A `claude plugin` that answers by its first words (`list`, `marketplace list`, `validate`...). */
function cli(answers: Answers = {}): PluginCli {
  return {
    run: async (args) => {
      const answer = answers[args.slice(0, 2).join(" ")] ?? answers[args[0] ?? ""] ?? {};
      return { code: 0, stdout: "[]", stderr: "", ...answer };
    },
  };
}

const plugins = (answers: Answers = {}, pins: Record<string, Pin> = {}) =>
  new Plugins({
    cli: cli(answers),
    pins: { all: async () => pins, set: async () => {}, delete: async () => {} },
  });

/** A marketplace folder with a catalog, and the CLI's listing that points at it. */
function marketplace(catalog: unknown | null) {
  const location = tempDir("fd-market-");
  if (catalog !== null) {
    mkdirSync(join(location, ".claude-plugin"));
    writeFileSync(join(location, ".claude-plugin", "marketplace.json"), JSON.stringify(catalog));
  }
  return {
    "marketplace list": { stdout: JSON.stringify([{ name: "acme", installLocation: location }]) },
  };
}

/** A plugin folder whose `validate` passes. */
function localPlugin() {
  const dir = tempDir("fd-plugin-");
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "p", version: "1.0.0" }),
  );
  return dir;
}

describe("recusas-plugins: what the person asked", () => {
  test("a value that reads as an option, a plugin that is not installed", async () => {
    expect(await refused(() => plugins().detail("-x"))).toEqual({
      code: "bad_request",
      reason: "plugin_arg_refused",
      params: { value: "-x" },
    });
    expect(await refused(() => plugins().detail("p@acme"))).toEqual({
      code: "not_found",
      reason: "plugin_not_installed",
      params: { id: "p@acme" },
    });
  });

  test("a change that needs confirm says which", async () => {
    const p = plugins();
    expect((await refused(() => p.uninstall({ plugin: "p@acme", confirm: false }))).reason).toBe(
      "plugin_remove_confirm",
    );
    expect(
      (await refused(() => p.marketplaceAdd({ source: "acme/x", confirm: false }))).reason,
    ).toBe("marketplace_add_confirm");
    expect(
      (await refused(() => p.marketplaceRemove({ name: "acme", confirm: false }))).reason,
    ).toBe("marketplace_remove_confirm");
  });

  test("a version that is pinned is not updated", async () => {
    const pinned = plugins({}, { "p@acme": { version: "1.2.0", hash: "h", at: "t" } });
    expect(await refused(() => pinned.update({ plugin: "p@acme", confirmHash: "h" }))).toEqual({
      code: "invalid_state",
      reason: "plugin_pinned",
      params: { id: "p@acme", version: "1.2.0" },
    });
  });

  test("a manager that was stopped starts nothing", async () => {
    const p = plugins();
    p.close();
    expect(await refused(() => p.list())).toEqual({
      code: "invalid_state",
      reason: "plugins_stopped",
      params: undefined,
    });
  });
});

describe("recusas-plugins: the marketplaces", () => {
  test("a marketplace that does not exist, a catalog that cannot be read, a plugin it does not list", async () => {
    expect(await refused(() => plugins().preview({ plugin: "p@acme" }))).toEqual({
      code: "not_found",
      reason: "marketplace_missing",
      params: { marketplace: "acme" },
    });
    expect(await refused(() => plugins(marketplace(null)).preview({ plugin: "p@acme" }))).toEqual({
      code: "invalid_state",
      reason: "marketplace_catalog_unreadable",
      params: { marketplace: "acme" },
    });
    expect(
      await refused(() => plugins(marketplace({ plugins: [] })).preview({ plugin: "p@acme" })),
    ).toEqual({ code: "not_found", reason: "plugin_not_in_marketplace", params: { id: "p@acme" } });
  });

  test("a plugin that comes from elsewhere cannot be shown before it is installed", async () => {
    const answers = marketplace({
      plugins: [{ name: "p", source: { source: "github", repo: "a/b" } }],
    });
    expect(
      await refused(() => plugins(answers).install({ plugin: "p@acme", confirmHash: "h" })),
    ).toEqual({
      code: "invalid_state",
      reason: "plugin_preview_unavailable_install",
      params: { name: "p@acme" },
    });
  });

  test("refreshing the marketplace for an update can fail, and the installed plugin may show nothing", async () => {
    const failing = plugins({ "marketplace update": { code: 1, stderr: "boom" } });
    expect(await refused(() => failing.previewUpdate("p@acme"))).toEqual({
      code: "invalid_state",
      reason: "marketplace_update_failed",
      params: { marketplace: "acme", why: "boom" },
    });
    const bare = plugins({
      "marketplace update": { stdout: "{}" },
      list: { stdout: JSON.stringify([{ id: "p@acme", version: "1" }]) },
      ...marketplace({ plugins: [{ name: "p", source: "github:a/b" }] }),
    });
    expect((await refused(() => bare.previewUpdate("p@acme"))).reason).toBe(
      "plugin_preview_unavailable_update",
    );
  });
});

describe("recusas-plugins: installing from a folder", () => {
  test("a plugin the validator refuses, content that changed, a command that was not shown", async () => {
    const dir = localPlugin();
    const hash = (await inspectPlugin(dir)).hash;
    const failing = plugins({ validate: { code: 1, stdout: "", stderr: "bad manifest" } });
    expect(await refused(() => failing.install({ dir, confirmHash: hash }))).toEqual({
      code: "invalid_state",
      reason: "plugin_validate_refused",
      params: { errors: "bad manifest" },
    });
    const passing = plugins({ validate: { stdout: JSON.stringify({ success: true }) } });
    expect((await refused(() => passing.install({ dir, confirmHash: "other" }))).reason).toBe(
      "plugin_content_changed",
    );
    expect(
      (await refused(() => passing.install({ dir, confirmHash: hash, acceptCommand: "zz" })))
        .reason,
    ).toBe("plugin_command_mismatch");
  });
});

describe("recusas-plugins: the CLI", () => {
  test("a command that fails, one that does not answer JSON, and no claude on the PATH", async () => {
    expect(await refused(() => plugins({ list: { code: 1, stderr: "nope" } }).list())).toEqual({
      code: "invalid_state",
      reason: "plugin_cli_failed",
      params: { command: "list", why: "nope" },
    });
    expect(await refused(() => plugins({ list: { stdout: "not json" } }).list())).toEqual({
      code: "invalid_state",
      reason: "plugin_cli_not_json",
      params: { command: "list" },
    });
    expect(await refused(() => claudeCli({ executable: () => null }).run(["list"]))).toEqual({
      code: "invalid_state",
      reason: "claude_not_found",
      params: undefined,
    });
  });
});

describe("recusas-plugins: the inventory", () => {
  test("a folder that is not there, and one with too many files", async () => {
    expect(await refused(() => inspectPlugin("/nowhere/plugin"))).toEqual({
      code: "not_found",
      reason: "plugin_dir_missing",
      params: { dir: "/nowhere/plugin" },
    });
    const dir = tempDir("fd-big-");
    for (let i = 0; i <= 5000; i++) writeFileSync(join(dir, `f${i}`), "");
    expect(await refused(() => inspectPlugin(dir))).toEqual({
      code: "bad_request",
      reason: "plugin_too_many_files",
      params: { max: 5000 },
    });
  });
});
