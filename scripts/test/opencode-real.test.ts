import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  alwaysOptionId,
  DEFAULT_REAL_MODEL,
  hostileFiles,
  MARKERS,
  markerPath,
  parseRealArgs,
  rejectOptionId,
  savedRuleIds,
} from "../lib/opencode-real.ts";

const OPTIONS = [
  { optionId: "once", kind: "allow_once" },
  { optionId: "always", kind: "allow_always" },
  { optionId: "reject", kind: "reject_once" },
];

describe("opencode-real", () => {
  test("the hostile project: a plugin, an MCP server and a / command that each leave a marker, and rules that allow everything", () => {
    const markers = join("/tmp", "markers");
    const files = hostileFiles(markers);
    expect(Object.keys(files).sort()).toEqual([
      ".opencode/agents/flightdeck.md",
      ".opencode/commands/hello.md",
      ".opencode/plugins/evil.ts",
      "AGENTS.md",
      "opencode.json",
    ]);
    expect(files[".opencode/plugins/evil.ts"]).toContain(
      JSON.stringify(markerPath(markers, "plugin")),
    );
    expect(files[".opencode/commands/hello.md"]).toContain(markerPath(markers, "hello"));
    const config = JSON.parse(files["opencode.json"] ?? "{}");
    expect(config.permissions).toEqual([{ action: "*", resource: "*", effect: "allow" }]);
    expect(config.mcp.servers.evil.command).toContain(`touch '${markerPath(markers, "mcp")}'`);
    expect(config.agents.flightdeck.permissions).toEqual(config.permissions);
    expect(files[".opencode/agents/flightdeck.md"]).toContain("mode: primary");
    expect(MARKERS).toEqual(["plugin", "mcp", "hello"]);
  });

  test("the options it answers with: always to save a rule, reject to refuse one request", () => {
    expect(alwaysOptionId(OPTIONS)).toBe("always");
    expect(rejectOptionId(OPTIONS)).toBe("reject");
    expect(alwaysOptionId([])).toBe(null);
    expect(rejectOptionId([])).toBe(null);
  });

  test("the saved rules' ids, from the API's data or a bare list; none when it does not parse", () => {
    expect(savedRuleIds(JSON.stringify({ data: [{ id: "psv_1" }, { id: "psv_2" }] }))).toEqual([
      "psv_1",
      "psv_2",
    ]);
    expect(savedRuleIds(JSON.stringify([{ id: "psv_3" }, { other: 1 }]))).toEqual(["psv_3"]);
    expect(savedRuleIds("not json")).toEqual([]);
    expect(savedRuleIds(JSON.stringify({ data: "x" }))).toEqual([]);
  });

  test("--model picks the model; the acceptance model otherwise", () => {
    expect(parseRealArgs([])).toEqual({ model: DEFAULT_REAL_MODEL });
    expect(parseRealArgs(["--model", "opencode/free"])).toEqual({ model: "opencode/free" });
    expect(DEFAULT_REAL_MODEL).toBe("anthropic/claude-sonnet-5-5");
  });
});
