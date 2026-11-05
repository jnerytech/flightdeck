import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import {
  globalConfigDir,
  type ScopeOptions,
  scanOpenCodeScope,
} from "../src/runtime/opencode-scope.ts";

/** A HOME with an empty global config folder, no system dir and no managed dir. */
function scope() {
  const home = realTempDir("fd-oc-home-");
  const global = join(home, ".config", "opencode");
  mkdirSync(global, { recursive: true });
  const system = join(realTempDir("fd-oc-etc-"), "opencode");
  const managed = realTempDir("fd-oc-managed-");
  const opts: ScopeOptions = { env: { HOME: home }, systemDirs: [system], managedDirs: [managed] };
  return { home, global, system, managed, opts };
}

const kinds = async (opts: ScopeOptions) =>
  (await scanOpenCodeScope(opts)).findings.map((f) => [f.kind, f.detail ?? null]);

describe("opencode-scope", () => {
  test("the global folder is XDG_CONFIG_HOME/opencode, else HOME (or USERPROFILE)/.config/opencode", () => {
    expect(globalConfigDir({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/h" })).toBe(
      join("/x/cfg", "opencode"),
    );
    expect(globalConfigDir({ HOME: "/h" })).toBe(join("/h", ".config", "opencode"));
    expect(globalConfigDir({ USERPROFILE: "C:/Users/a" })).toBe(
      join("C:/Users/a", ".config", "opencode"),
    );
    expect(globalConfigDir({ XDG_CONFIG_HOME: "", HOME: "/h" })).toBe(
      join("/h", ".config", "opencode"),
    );
  });

  test("a clean global folder and no system config give no finding", async () => {
    const s = scope();
    writeFileSync(
      join(s.global, "opencode.json"),
      JSON.stringify({ model: "anthropic/claude-sonnet-5-5" }),
    );
    expect(await kinds(s.opts)).toEqual([]);
  });

  test("a plugins entry is a finding; removals alone are not", async () => {
    const s = scope();
    writeFileSync(
      join(s.global, "opencode.jsonc"),
      '{\n // mine\n "plugins": ["-acme.*", "opencode-wakatime",],\n}',
    );
    expect(await kinds(s.opts)).toEqual([["plugins_entry", "opencode-wakatime"]]);
    writeFileSync(join(s.global, "opencode.jsonc"), '{ "plugins": ["-*"] }');
    expect(await kinds(s.opts)).toEqual([]);
    writeFileSync(
      join(s.global, "opencode.jsonc"),
      '{ "plugins": [{ "package": "@acme/p", "options": {} }] }',
    );
    expect(await kinds(s.opts)).toEqual([["plugins_entry", "@acme/p"]]);
  });

  test("a file in plugins/ or plugin/ is a finding", async () => {
    const s = scope();
    mkdirSync(join(s.global, "plugins"));
    writeFileSync(join(s.global, "plugins", "notify.ts"), "export default {}");
    mkdirSync(join(s.global, "plugin", "pkg"), { recursive: true });
    expect((await kinds(s.opts)).sort()).toEqual([
      ["plugin_file", "notify.ts"],
      ["plugin_file", "pkg"],
    ]);
  });

  test("an enabled MCP server is a finding, a disabled one is not", async () => {
    const s = scope();
    writeFileSync(
      join(s.global, "opencode.json"),
      JSON.stringify({
        mcp: { servers: { ctx: { type: "local", command: ["x"] }, off: { disabled: true } } },
      }),
    );
    expect(await kinds(s.opts)).toEqual([["mcp_server", "ctx"]]);
  });

  test("any system config or managed preference is a finding", async () => {
    const s = scope();
    mkdirSync(s.system, { recursive: true });
    writeFileSync(join(s.system, "opencode.json"), "{}");
    writeFileSync(join(s.managed, "ai.opencode.plist"), "<plist/>");
    writeFileSync(join(s.managed, "com.other.plist"), "<plist/>");
    expect(await kinds(s.opts)).toEqual([
      ["system_config", null],
      ["managed_config", null],
    ]);
  });

  test("the v1 key plugin counts like plugins; an entry of unknown shape is named without its options", async () => {
    const s = scope();
    writeFileSync(
      join(s.global, "opencode.json"),
      JSON.stringify({ plugin: ["old-plugin"], plugins: [42] }),
    );
    expect(await kinds(s.opts)).toEqual([
      ["plugins_entry", "(unknown entry)"],
      ["plugins_entry", "old-plugin"],
    ]);
  });

  test("plugins or mcp of a shape nobody expects fail closed; v1 server names next to servers are read too", async () => {
    const s = scope();
    writeFileSync(join(s.global, "opencode.json"), JSON.stringify({ plugins: "x", mcp: "y" }));
    expect(await kinds(s.opts)).toEqual([
      ["unreadable_config", "plugins"],
      ["unreadable_config", "mcp"],
    ]);
    writeFileSync(
      join(s.global, "opencode.json"),
      JSON.stringify({ mcp: { servers: { a: { type: "local" } }, b: { type: "local" } } }),
    );
    expect(await kinds(s.opts)).toEqual([
      ["mcp_server", "a"],
      ["mcp_server", "b"],
    ]);
  });

  test("files in tool/ or tools/ are code too", async () => {
    const s = scope();
    mkdirSync(join(s.global, "tool"));
    writeFileSync(join(s.global, "tool", "t.ts"), "");
    mkdirSync(join(s.global, "tools"));
    writeFileSync(join(s.global, "tools", "u.ts"), "");
    expect((await kinds(s.opts)).sort()).toEqual([
      ["plugin_file", "t.ts"],
      ["plugin_file", "u.ts"],
    ]);
  });

  test("on Windows the global folder follows USERPROFILE, as OpenCode's home does", () => {
    expect(globalConfigDir({ HOME: "/h", USERPROFILE: "C:/Users/a" }, "win32")).toBe(
      join("C:/Users/a", ".config", "opencode"),
    );
    expect(globalConfigDir({ HOME: "/h", USERPROFILE: "C:/Users/a" }, "linux")).toBe(
      join("/h", ".config", "opencode"),
    );
  });

  test("a config that does not parse fails closed", async () => {
    const s = scope();
    writeFileSync(join(s.global, "opencode.json"), "{ not json");
    expect(await kinds(s.opts)).toEqual([["unreadable_config", null]]);
  });

  test("the fingerprint changes when a config or plugin file is added, changed or removed, not for other files", async () => {
    const s = scope();
    const fp = async () => (await scanOpenCodeScope(s.opts)).fingerprint;
    const empty = await fp();
    expect(empty.length).toBeGreaterThan(0);
    writeFileSync(join(s.global, "tui.json"), "{}");
    expect(await fp()).toBe(empty);
    writeFileSync(join(s.global, "opencode.json"), "{}");
    const withConfig = await fp();
    expect(withConfig).not.toBe(empty);
    writeFileSync(join(s.global, "opencode.json"), '{"model":"a/b"}');
    const changed = await fp();
    expect(changed).not.toBe(withConfig);
    mkdirSync(join(s.global, "plugins"));
    writeFileSync(join(s.global, "plugins", "x.ts"), "");
    expect(await fp()).not.toBe(changed);
    rmSync(join(s.global, "plugins", "x.ts"));
    expect(await fp()).toBe(changed);
  });

  test("with no HOME at all the scan still answers, from the system scope only", async () => {
    const s = scope();
    const result = await scanOpenCodeScope({ ...s.opts, env: {} });
    expect(result.findings).toEqual([]);
    expect(result.fingerprint.length).toBeGreaterThan(0);
  });
});
