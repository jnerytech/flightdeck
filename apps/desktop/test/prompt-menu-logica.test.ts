import { describe, expect, test } from "bun:test";
import { filterMenu, fuzzyScore, groupOf, highlight, MENU_GROUPS } from "../src/lib/prompt-menu.ts";

const slash = (name: string, description?: string) => ({
  key: `slash:${name}`,
  name: `/${name}`,
  ...(description ? { description } : {}),
});
const snippet = (name: string) => ({ key: `s-${name}`, name });

describe("prompt-menu: what the / menu offers", () => {
  test("a snippet, a plain command, a plugin skill and an MCP prompt each have their group", () => {
    expect(groupOf(snippet("revisar"))).toBe("snippets");
    expect(groupOf(slash("compact"))).toBe("commands");
    expect(groupOf(slash("superpowers:brainstorming"))).toBe("skills");
    expect(groupOf(slash("mcp__github__create_pr"))).toBe("mcp");
  });

  test("the groups are listed commands, snippets, skills, MCP prompts", () => {
    expect(MENU_GROUPS).toEqual(["commands", "snippets", "skills", "mcp"]);
  });

  test("a name that contains the query beats a spread-out match, which beats a description hit", () => {
    const contiguous = fuzzyScore("rev", slash("review")) as number;
    const spread = fuzzyScore("rvw", slash("review")) as number;
    const byDescription = fuzzyScore("rev", slash("compact", "reverse the log")) as number;
    expect(contiguous).toBeGreaterThan(spread);
    expect(spread).toBeGreaterThan(byDescription);
    expect(byDescription).toBeGreaterThan(0);
  });

  test("an item that does not fit scores null, and an empty query fits all", () => {
    expect(fuzzyScore("zzz", slash("review", "check a PR"))).toBeNull();
    expect(fuzzyScore("", slash("review"))).toBe(0);
  });

  test("the filter keeps the groups in order, drops the empty ones and ranks inside a group", () => {
    const items = [
      slash("mcp__srv__review"),
      slash("compact"),
      snippet("code-review"),
      slash("review"),
      slash("plug:review"),
    ];
    expect(filterMenu(items, "review").map((s) => [s.group, s.items.map((i) => i.name)])).toEqual([
      ["commands", ["/review"]],
      ["snippets", ["code-review"]],
      ["skills", ["/plug:review"]],
      ["mcp", ["/mcp__srv__review"]],
    ]);
    expect(filterMenu(items, "").map((s) => s.group)).toEqual([
      "commands",
      "snippets",
      "skills",
      "mcp",
    ]);
  });

  test("the match is marked in the name, a contiguous one as one run", () => {
    expect(highlight("/review", "rev")).toEqual([
      { text: "/", hit: false },
      { text: "rev", hit: true },
      { text: "iew", hit: false },
    ]);
    expect(highlight("/review", "rvw")).toEqual([
      { text: "/", hit: false },
      { text: "r", hit: true },
      { text: "e", hit: false },
      { text: "v", hit: true },
      { text: "ie", hit: false },
      { text: "w", hit: true },
    ]);
    expect(highlight("/review", "")).toEqual([{ text: "/review", hit: false }]);
  });
});
