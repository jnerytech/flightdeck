import { describe, expect, test } from "bun:test";
import { isClaudeConfig } from "../../src/kernel/index.ts";

describe("isClaudeConfig (#3825)", () => {
  test("anything inside a .claude folder, a CLAUDE.md, a CLAUDE.local.md and a .mcp.json count, however they are spelled", () => {
    expect(
      [
        ".claude/settings.json",
        "./.Claude//Settings.json",
        ".claude\\agents\\a.md",
        "apps/web/.claude/skills/x/SKILL.md",
        "CLAUDE.md",
        "docs/claude.local.md",
        "docs/CLAUDE~1.MD",
        "docs/CLAUDE~2.MD.",
        "docs/CLAUDE~1.MD::$DATA",
        "CLAUDE~1/settings.json",
        ".mcp.json",
        "apps/api/.MCP.JSON",
        "./.mcp.json.",
        "apps/api/MCP~1.JSO",
      ].filter((path) => !isClaudeConfig(path)),
    ).toEqual([]);
  });

  test("other files do not, nor a .claude file that is the last step itself", () => {
    expect(
      [
        "a.txt",
        "docs/claude.txt",
        "claudex.md",
        "src/CLAUDE~.md",
        ".claude",
        "mcp.json",
        ".mcp.json/x.txt",
      ].filter((path) => isClaudeConfig(path)),
    ).toEqual([]);
  });
});
