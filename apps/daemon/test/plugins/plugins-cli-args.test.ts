import { describe, expect, test } from "bun:test";
import { pluginsCliArgs } from "../../src/cli/domain/plugins-args.ts";
import { parseArgs } from "../../src/main.ts";

/** What `flightdeckd plugins ...` hands the runner for what the person typed (issue #3516). */
const mapped = (argv: string[]) => pluginsCliArgs(parseArgs(argv));

describe("flightdeckd plugins: what the parsed words become for the runner", () => {
  test("the read verbs carry the plugin and --json, and a list has no plugin", () => {
    expect(mapped(["plugins", "list", "--json"])).toEqual({ action: "list", json: true });
    expect(mapped(["plugins", "detail", "a@b"])).toEqual({ action: "detail", plugin: "a@b" });
    expect(mapped(["plugins", "preview-update", "a@b"])).toEqual({
      action: "preview-update",
      plugin: "a@b",
    });
  });

  test("an install names a plugin or a folder, repeats the hash and keeps the scope and the command it accepts", () => {
    expect(
      mapped([
        "plugins",
        "install",
        "a@b",
        "--confirm-hash",
        "h1",
        "--plugin-scope",
        "project",
        "--accept-command",
        "x",
      ]),
    ).toEqual({
      action: "install",
      plugin: "a@b",
      confirmHash: "h1",
      acceptCommand: "x",
      scope: "project",
    });
    expect(mapped(["plugins", "install", "--dir", "mine", "--confirm-hash", "h1"])).toEqual({
      action: "install",
      dir: "mine",
      confirmHash: "h1",
    });
    expect(mapped(["plugins", "update", "a@b", "--confirm-hash", "h1"])).toEqual({
      action: "update",
      plugin: "a@b",
      confirmHash: "h1",
    });
  });

  test("an uninstall keeps its scope and its --confirm, and a pin or an unpin names only the plugin", () => {
    expect(mapped(["plugins", "uninstall", "a@b", "--plugin-scope", "user", "--confirm"])).toEqual({
      action: "uninstall",
      plugin: "a@b",
      scope: "user",
      confirm: true,
    });
    expect(mapped(["plugins", "pin", "a@b"])).toEqual({ action: "pin", plugin: "a@b" });
    expect(mapped(["plugins", "unpin", "a@b"])).toEqual({ action: "unpin", plugin: "a@b" });
  });

  test("the marketplace verbs name a source or a marketplace, and an update with none updates all", () => {
    expect(mapped(["plugins", "marketplace-add", "acme/repo", "--confirm"])).toEqual({
      action: "marketplace-add",
      source: "acme/repo",
      confirm: true,
    });
    expect(mapped(["plugins", "marketplace-remove", "acme"])).toEqual({
      action: "marketplace-remove",
      name: "acme",
    });
    expect(mapped(["plugins", "marketplace-update"])).toEqual({ action: "marketplace-update" });
    expect(mapped(["plugins", "marketplace-update", "acme", "--json"])).toEqual({
      action: "marketplace-update",
      name: "acme",
      json: true,
    });
  });

  test("a preview names a plugin or a folder", () => {
    expect(mapped(["plugins", "preview", "a@b"])).toEqual({ action: "preview", plugin: "a@b" });
    expect(mapped(["plugins", "preview", "--dir", "mine"])).toEqual({
      action: "preview",
      dir: "mine",
    });
  });
});
