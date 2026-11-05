import { describe, expect, test } from "bun:test";
import { planRelated, selectByPath } from "../lib/test-related.ts";

const SOURCES = new Map([
  [
    "scripts/test/harness-config.test.ts",
    'readFileSync(join(ROOT, ".claude/settings.json")); readdirSync(join(ROOT, ".claude/agents")); spawn(".claude/hooks/guard.ts")',
  ],
  ["scripts/test/wait-ratchet.test.ts", "const baseline = read('wait-baseline.json');"],
  ["scripts/test/other.test.ts", 'expect(x).toBe("docsy")'],
  ["apps/daemon/test/memoria.test.ts", 'write(join(home, ".claude"), "CLAUDE.md", "docs")'],
  ["apps/desktop/test/layout-ratchet.test.ts", 'resolve(DESKTOP, "layout-baseline.json")'],
  ["scripts/lib/reader.ts", 'readFileSync(".claude/settings.json")'],
]);

describe("related-non-ts", () => {
  test("a test that names a changed file, or one of its folders, is related to it", () => {
    expect(selectByPath([".claude/settings.json"], SOURCES)).toEqual([
      { path: "scripts/test/harness-config.test.ts", why: "names .claude/settings.json" },
    ]);
    expect(selectByPath([".claude/agents/security-reviewer.md"], SOURCES)).toEqual([
      { path: "scripts/test/harness-config.test.ts", why: "names .claude/agents" },
    ]);
    expect(selectByPath([".claude/hooks/guard.ts"], SOURCES)).toEqual([
      { path: "scripts/test/harness-config.test.ts", why: "names .claude/hooks/guard.ts" },
    ]);
    expect(selectByPath(["wait-baseline.json"], SOURCES)).toEqual([
      { path: "scripts/test/wait-ratchet.test.ts", why: "names wait-baseline.json" },
    ]);
  });

  test("a partial name, a source that is not a test, or no mention selects nothing", () => {
    expect(selectByPath(["docs/TDD.md"], SOURCES)).toEqual([]);
    expect(selectByPath(["README.md"], SOURCES)).toEqual([]);
  });

  test("a top-level folder or a root file is a word, not a path: only a baseline's own name counts", () => {
    expect(
      selectByPath(["CLAUDE.md", ".claude/rules/ui.md", "docs/manual/en.md"], SOURCES),
    ).toEqual([]);
    expect(selectByPath(["apps/desktop/layout-baseline.json"], SOURCES)).toEqual([
      { path: "apps/desktop/test/layout-ratchet.test.ts", why: "names layout-baseline.json" },
    ]);
  });

  test("test:related runs the tests that name a changed data file", () => {
    const plan = planRelated({
      platform: "linux",
      git: (args) => {
        if (args[0] === "merge-base") return "abc1234\n";
        if (args[0] === "diff") return ".claude/settings.json\n";
        if (args[0] === "ls-files") return [...SOURCES.keys()].join("\n");
        return null;
      },
      readFile: (path) => SOURCES.get(path) ?? "",
    });
    expect(plan.output).toContain(
      "scripts/test/harness-config.test.ts  names .claude/settings.json",
    );
    expect(plan.command?.at(-1)).toBe("./scripts/test/harness-config.test.ts");
  });
});
