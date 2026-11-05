import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { linted, lintSpec, SECTIONS, specAreas } from "../lib/spec-lint.ts";

const ROOT = resolve(import.meta.dir, "../..");
const TEMPLATE = join(ROOT, "docs/templates/SPEC.md");

const TABLE = [
  "| Area | Test file | What must pass |",
  "| --- | --- | --- |",
  "| `board-pull` | `apps/daemon/test/board-pull.test.ts` | a new item becomes a card |",
  "| board-sync-ui | `apps/desktop/test/board-sync-ui.test.tsx` | the control, both languages |",
  "| `board-sync-smoke` | `scripts/smoke-boardsync.ts` | prints SMOKE BOARDSYNC OK |",
  "| `assistant-keys` | `apps/desktop/src-tauri/src/keys.rs` | set, status, delete (a Rust module's tests) |",
  "| `assistant-guard` | `apps/desktop/src-tauri/tests/assistant_guard.rs` | limits (a Rust integration test) |",
].join("\n");

/** A spec with every section; `body` replaces the text of the named sections. */
function spec(
  body: Record<string, string> = {},
  title = "# Flightdeck — Phase 41 spec (board sync)",
) {
  return [
    title,
    "",
    ...SECTIONS.flatMap((s) => [
      `## ${s}`,
      "",
      body[s] ?? (s === "Tests and criteria" ? TABLE : "None."),
      "",
    ]),
  ].join("\n");
}

describe("spec-lint", () => {
  test("the template and a spec with every section in order pass", () => {
    expect(lintSpec(readFileSync(TEMPLATE, "utf8"))).toEqual([]);
    expect(lintSpec(spec())).toEqual([]);
    expect(
      lintSpec(spec({ Design: "- one\n\n## Answers to the open questions\n\n- two" })),
    ).toEqual([]);
  });

  test("a missing section, one out of order and a wrong title are named", () => {
    const missing = spec().replace("## Risks\n\nNone.\n\n", "");
    expect(lintSpec(missing)).toEqual(["missing section: ## Risks (after ## Tests and criteria)"]);
    const swapped = spec()
      .replace("## Goal", "## Tmp")
      .replace("## Non-goals", "## Goal")
      .replace("## Tmp", "## Non-goals");
    expect(lintSpec(swapped)).toEqual(["missing section: ## Non-goals (after ## Goal)"]);
    expect(lintSpec(spec({}, "# Phase 41 (board sync)"))).toEqual([
      "line 1: the title is `# Flightdeck — Phase N spec (<theme>)`",
    ]);
  });

  test("the area table has its three columns, and each row a kebab area and a test file by docs/TDD.md", () => {
    expect(
      lintSpec(spec({ "Tests and criteria": "| Area | What must pass |\n| --- | --- |" })),
    ).toEqual([
      "Tests and criteria: the table needs the columns | Area | Test file | What must pass |",
    ]);
    const rows = [
      "| Area | Test file | What must pass |",
      "| --- | --- | --- |",
      "| `BoardPull` | `apps/daemon/test/BoardPull.test.ts` | x |",
      "| `board-map` | `apps/daemon/src/board-map.ts` | x |",
      "| `board-graph` | `apps/daemon/test/board-graphql.test.ts` | x |",
      "| `board-sync-ui` | `apps/daemon/test/board-sync-ui.test.ts` | x |",
    ].join("\n");
    const problems = lintSpec(spec({ "Tests and criteria": rows }));
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain("`BoardPull` is not kebab-case");
    expect(problems[1]).toContain("apps/daemon/src/board-map.ts is not a test file");
    expect(problems[2]).toContain("the test file of `board-graph` is board-graph.test.ts(x)");
    expect(problems[3]).toContain("a -ui area is tested in apps/desktop/test/");
  });

  test("each Feature in the acceptance scenarios names the .feature file that runs it", () => {
    const gherkin = "```gherkin\nFeature: Sync\n\n  Scenario: a\n    Given x\n```";
    expect(lintSpec(spec({ "Acceptance scenarios": gherkin }))).toEqual([
      "Acceptance scenarios: 1 Feature but 0 scripts/e2e/bdd/features/*.feature named",
    ]);
    const named = `${gherkin}\n\nRuns as \`scripts/e2e/bdd/features/sync.feature\`.`;
    expect(lintSpec(spec({ "Acceptance scenarios": named }))).toEqual([]);
  });

  test("a Rust crate inside src-tauri has its tests in its own src and tests; nothing else of the shell is a test", () => {
    const rows = (file: string) =>
      [
        "| Area | Test file | What must pass |",
        "| --- | --- | --- |",
        `| \`assistant-keys\` | \`${file}\` | x |`,
      ].join("\n");
    const problems = (file: string) => lintSpec(spec({ "Tests and criteria": rows(file) })).length;
    expect(
      [
        "apps/desktop/src-tauri/assistant/src/keys.rs",
        "apps/desktop/src-tauri/assistant/tests/guard.rs",
        "apps/desktop/src-tauri/assistant/Cargo.toml",
        "apps/desktop/src-tauri/a/b/src/x.rs",
        "apps/desktop/other/src/x.rs",
      ].map(problems),
    ).toEqual([0, 0, 1, 1, 1]);
  });

  test("specAreas reads the table's areas, test files and lines", () => {
    expect(specAreas(spec()).map((a) => [a.area, a.testFile])).toEqual([
      ["board-pull", "apps/daemon/test/board-pull.test.ts"],
      ["board-sync-ui", "apps/desktop/test/board-sync-ui.test.tsx"],
      ["board-sync-smoke", "scripts/smoke-boardsync.ts"],
      ["assistant-keys", "apps/desktop/src-tauri/src/keys.rs"],
      ["assistant-guard", "apps/desktop/src-tauri/tests/assistant_guard.rs"],
    ]);
    expect(specAreas(spec())[0]?.line).toBe(
      spec()
        .split("\n")
        .indexOf(TABLE.split("\n")[2] ?? "") + 1,
    );
  });

  test("phase 40 on is linted, older specs only when they ask for it", () => {
    expect(linted("docs/SPEC-fase-40.md", "")).toBe(true);
    expect(linted("docs/SPEC-fase-39.md", "")).toBe(false);
    expect(linted("docs/SPEC-fase-12.md", "<!-- spec-lint -->\n")).toBe(true);
    expect(linted("docs/SPEC.md", "")).toBe(false);
  });

  test("every linted spec in docs/ has the shape", () => {
    const dir = join(ROOT, "docs");
    const problems = readdirSync(dir)
      .filter((name) => /^SPEC-fase-\d+\.md$/.test(name) && existsSync(join(dir, name)))
      .flatMap((name) => {
        const text = readFileSync(join(dir, name), "utf8");
        return linted(`docs/${name}`, text) ? lintSpec(text).map((p) => `${name}: ${p}`) : [];
      });
    expect(problems).toEqual([]);
  });
});
