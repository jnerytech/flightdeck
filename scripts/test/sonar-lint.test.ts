import { describe, expect, test } from "bun:test";
import {
  applySuppressions,
  exclusionsOf,
  type Finding,
  formatFindings,
  lintTargets,
  type PluginRule,
  sonarRules,
} from "../lib/sonar-lint.ts";

const rule = (name: string, key: string, typed = false): PluginRule => ({
  name,
  url: `https://sonarsource.github.io/rspec/#/rspec/${key}/javascript`,
  typed,
});

describe("sonar-lint: which plugin rules match the SonarCloud profile", () => {
  const rules = [
    rule("no-ignored-return", "S2201", true),
    rule("no-empty-collection", "S4158"),
    rule("function-name", "S100"),
  ];

  test("the rules the profile activates become ESLint ids, split by type information", () => {
    const set = sonarRules(rules, ["typescript:S2201", "typescript:S4158"]);
    expect(set.untyped).toEqual(["sonarjs/no-empty-collection"]);
    expect(set.typed).toEqual(["sonarjs/no-ignored-return"]);
  });

  test("a plugin rule the profile does not activate stays off", () => {
    const set = sonarRules(rules, ["typescript:S4158"]);
    expect([...set.untyped, ...set.typed]).not.toContain("sonarjs/function-name");
  });

  test("profile keys without a plugin rule are listed, other repositories are ignored", () => {
    const set = sonarRules(rules, ["typescript:S4158", "typescript:S9999", "tssecurity:S3649"]);
    expect(set.unmatched).toEqual(["S9999"]);
  });

  test("a rule whose url carries no key is skipped", () => {
    const odd: PluginRule = { name: "odd", url: "https://example.com/odd", typed: false };
    expect(sonarRules([odd], ["typescript:S1"]).untyped).toEqual([]);
  });
});

describe("sonar-lint: which files are checked", () => {
  const properties = [
    "sonar.sources=apps,packages,scripts",
    "sonar.exclusions=**/test/**,**/*.test.ts,apps/desktop/src/components/ui/**,**/dist/**",
    "sonar.coverage.exclusions=scripts/*.ts",
  ].join("\n");

  test("the exclusions come from sonar-project.properties", () => {
    expect(exclusionsOf(properties)).toEqual([
      "**/test/**",
      "**/*.test.ts",
      "apps/desktop/src/components/ui/**",
      "**/dist/**",
    ]);
  });

  test("no exclusions line gives an empty list", () => {
    expect(exclusionsOf("sonar.sources=apps")).toEqual([]);
  });

  test("source files stay, tests, vendor files, other languages and other folders go", () => {
    const exclusions = exclusionsOf(properties);
    expect(
      lintTargets(
        [
          "apps/daemon/src/board/board.ts",
          "apps/desktop/src/ui/Card.tsx",
          "apps/daemon/test/board.test.ts",
          "apps/desktop/src/components/ui/button.tsx",
          "apps/desktop/src-tauri/src/main.rs",
          "docs/SPEC.md",
          "scripts/lib/slot.ts",
          "tools/sonar-lint/package.json",
          "packages/protocol/dist/index.ts",
        ],
        exclusions,
      ),
    ).toEqual([
      "apps/daemon/src/board/board.ts",
      "apps/desktop/src/ui/Card.tsx",
      "scripts/lib/slot.ts",
    ]);
  });

  test("a single star stops at a slash", () => {
    expect(lintTargets(["scripts/a.ts", "scripts/lib/a.ts"], ["scripts/*.ts"])).toEqual([
      "scripts/lib/a.ts",
    ]);
  });
});

describe("sonar-lint: NOSONAR", () => {
  const finding = (line: number, rule = "sonarjs/no-empty-collection"): Finding => ({
    file: "a.ts",
    line,
    rule,
    message: "m",
  });
  const lines = [
    "const a = 1;",
    "log(x); // NOSONAR: the port is a literal, not user input",
    "log(y); // NOSONAR",
    "log(z); // NOSONAR -",
    "const b = [];",
  ];

  test("a NOSONAR with a reason silences the findings of its line", () => {
    expect(applySuppressions([finding(2)], () => lines)).toEqual([]);
  });

  test("findings on other lines stay", () => {
    expect(applySuppressions([finding(5)], () => lines)).toEqual([finding(5)]);
  });

  test("a NOSONAR with no reason still silences the line but is reported itself", () => {
    const out = applySuppressions([finding(3)], () => lines);
    expect(out).toEqual([
      {
        file: "a.ts",
        line: 3,
        rule: "nosonar-reason",
        message: "NOSONAR needs a reason after it, for example `// NOSONAR: why`",
      },
    ]);
  });

  test("a dash with nothing after it is not a reason", () => {
    expect(applySuppressions([finding(4)], () => lines).map((f) => f.rule)).toEqual([
      "nosonar-reason",
    ]);
  });

  test("a NOSONAR line with no finding is not reported", () => {
    expect(applySuppressions([], () => lines)).toEqual([]);
  });
});

describe("sonar-lint: the report", () => {
  test("one line per finding, ordered by file and line, with a total", () => {
    const out = formatFindings([
      { file: "b.ts", line: 2, rule: "sonarjs/x", message: "second" },
      { file: "a.ts", line: 9, rule: "sonarjs/y", message: "first" },
    ]);
    expect(out).toBe(
      [
        "a.ts:9  sonarjs/y  first",
        "b.ts:2  sonarjs/x  second",
        "",
        "lint:sonar: 2 finding(s)",
      ].join("\n"),
    );
  });

  test("no findings is said plainly", () => {
    expect(formatFindings([])).toBe("lint:sonar: no findings");
  });
});
