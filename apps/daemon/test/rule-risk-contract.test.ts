import { describe, expect, test } from "bun:test";
import ignore from "ignore";
import { RANK, RiskClassifier } from "../src/permissions/risk.ts";
import { type ClassifyCall, ruleLevel } from "../src/permissions/rule-risk.ts";

/**
 * The contract between `ruleLevel` and the matcher Claude Code runs for a Read or Edit rule
 * (issue #395). The CLI's path rules follow the gitignore spec, and its binary bundles the
 * `ignore` package (its error texts are in it), so `ignore` stands for the CLI's matching here.
 * What this test does not prove: how the CLI turns `//abs`, `~/`, `/` and a bare path into a root
 * and a relative path. It uses absolute rules (`//proj/...`) matched from `/`, the one form whose
 * root is plain (docs/decisions/2026-11-06-rule-contract.md).
 */

const PROJECT = "/proj";
const HOME = "/home/me";
const risk = new RiskClassifier({ allowedRoots: [], home: HOME });
const classify: ClassifyCall = (tool, input) => risk.classify(tool, input, PROJECT).level;

/** Paths a rule could cover: the project's code, its control files, and credentials in and out. */
const PROBES = [
  "/proj/src/a.ts",
  "/proj/src/b/c.ts",
  "/proj/src/.env",
  "/proj/src/b/.env",
  "/proj/src/.ssh/id_rsa",
  "/proj/src/ID_RSA",
  "/proj/src/x.pem",
  "/proj/src/credentials",
  "/proj/SRC/.env",
  "/proj/app-1.ts",
  "/proj/README.md",
  "/proj/.env",
  "/proj/.env.local",
  "/proj/.git/config",
  "/proj/.claude/settings.json",
  "/proj/package.json",
  "/home/me/.ssh/id_rsa",
  "/home/me/.aws/credentials",
  "/etc/passwd",
];

/** Rules a person could save from a request: a folder, a file, and wildcards in the project. */
const RULES = [
  "//proj/src",
  "//proj/src/",
  "//proj/src/a.ts",
  "//proj/src/*.ts",
  "//proj/src/**",
  "//proj/src/**/*.ts",
  "//proj/app-*.ts",
  "//proj/*.md",
  "//proj/**/*.ts",
];

/** Whether the CLI's matcher, read as `ignore`, lets `rule` cover `path`. */
function covers(rule: string, path: string, ignorecase: boolean): boolean {
  const pattern = rule.slice(1);
  return ignore({ ignorecase }).add(pattern).ignores(path.slice(1));
}

/** Each call the CLI would let a saved rule through that the daemon rates above the rule's level. */
function breaches(tool: string, ignorecase: boolean): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    const level = ruleLevel(tool, rule, classify);
    if (level === "any") continue;
    for (const path of PROBES.filter((probe) => covers(rule, probe, ignorecase))) {
      const call = classify(tool, { file_path: path });
      if (RANK[call] > RANK[level])
        found.push(`${tool}(${rule}) covers ${path}: ${call} > ${level}`);
    }
  }
  return found;
}

describe("rule-risk: a saved path rule covers no call riskier than its level, read as the CLI matches it (issue #395)", () => {
  for (const tool of ["Read", "Edit", "Write"]) {
    for (const ignorecase of [true, false]) {
      test(`${tool}, ${ignorecase ? "case-insensitive (Windows, the matcher's default)" : "case-sensitive"}`, () => {
        expect(breaches(tool, ignorecase)).toEqual([]);
      });
    }
  }

  test("the stand-in matcher reads a folder, a wildcard and a dotfile the gitignore way", () => {
    expect(covers("//proj/src", "/proj/src/b/c.ts", false)).toBe(true);
    expect(covers("//proj/src/*.ts", "/proj/src/b/c.ts", false)).toBe(false);
    expect(covers("//proj/src/**", "/proj/src/.env", false)).toBe(true);
    expect(covers("//proj/src", "/proj/SRC/.env", true)).toBe(true);
    expect(covers("//proj/src", "/proj/SRC/.env", false)).toBe(false);
  });
});
