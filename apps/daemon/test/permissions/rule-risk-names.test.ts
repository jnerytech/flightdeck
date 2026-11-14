import { describe, expect, test } from "bun:test";
import {
  type ClassifyCall,
  type PathKind,
  ruleLevel,
} from "../../src/permissions/domain/rule-risk.ts";

/**
 * What a wildcard in a path rule may stand for (issue #1607, the mutants of the name lists in
 * `rule-risk.ts` that no other test killed). The real classifier rates several of these names the
 * same as the plain placeholder, so a list that lost one is invisible through it. Each test
 * injects a classifier that rates exactly one path `high`: the rule is wide (`any`) only when its
 * wildcard can stand for that path.
 */

const file: PathKind = () => "file";

/** A classifier that rates the one path `high` and every other `low`. */
function onlyHigh(target: string): ClassifyCall {
  return (_tool, input) => (Object.values(input).includes(target) ? "high" : "low");
}

const level = (rule: string, target: string) => ruleLevel("Read", rule, onlyHigh(target), file);

describe("rule-risk: a wildcard stands for each name a credential has", () => {
  test("a path no wildcard can reach as a credential is rated by what it names", () => {
    expect(level("//proj/*", "/proj/unrelated")).toBe("low");
    expect(level("//proj/**/f", "/proj/unrelated/f")).toBe("low");
    expect(level("//proj/foo*", "/proj/unrelated")).toBe("low");
  });

  // The names a whole-segment wildcard shares with the partial-wildcard lists (`.env`, `.ssh`,
  // `.aws`, `id_rsa`, `credentials`) are found there too: only the ones those lists lack show a
  // whole-segment list that lost one. The `foo*` tests below cover the shared ones.
  for (const name of ["x.pem", "x.key"]) {
    test(`a '*' may stand for ${name}`, () => {
      expect(level("//proj/*", `/proj/${name}`)).toBe("any");
    });
  }

  for (const name of ["x", "x.pem", "x.key"]) {
    test(`a '**/' may stand for a folder named ${name}`, () => {
      expect(level("//proj/**/f", `/proj/${name}/f`)).toBe("any");
    });
  }

  // A wildcard inside a name takes the whole name as its text: `foo*` is `foo.env`, `foocredentials`.
  for (const name of [".env", "id_rsa", "x.pem", "x.key", ".ssh", ".aws", "credentials"]) {
    test(`a '*' after a prefix may stand for ${name}`, () => {
      expect(level("//proj/foo*", `/proj/foo${name}`)).toBe("any");
    });
  }
});

describe("rule-risk: a partial wildcard stands for the control and credential names it matches", () => {
  const cases: Array<[rule: string, path: string]> = [
    ["//proj/.conf*", "/proj/.config"],
    ["//proj/.flightd*", "/proj/.flightdeck"],
    ["//proj/.env.l*", "/proj/.env.local"],
    ["//proj/id_r*", "/proj/id_rsa"],
    ["//proj/credent*", "/proj/credentials"],
    ["//proj/*.pe*", "/proj/.pem"],
    ["//proj/.githu*", "/proj/.github"],
    ["//proj/.vscod*", "/proj/.vscode"],
  ];
  for (const [rule, path] of cases) {
    test(`${rule} may stand for ${path}`, () => {
      expect(level(rule, path)).toBe("any");
    });
  }

  test("a partial wildcard that matches none of them is rated by what it names", () => {
    expect(level("//proj/zzz*", "/proj/.config")).toBe("low");
  });
});
