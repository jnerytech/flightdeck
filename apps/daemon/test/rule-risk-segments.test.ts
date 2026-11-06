import { describe, expect, test } from "bun:test";
import { type ClassifyCall, ruleLevel } from "../src/permissions/rule-risk.ts";
import { credential } from "../src/permissions/risk.ts";

// The classifier is the daemon's own on the path a call names; here, its credential rule alone.
const classify: ClassifyCall = (_tool, input) =>
  Object.values(input).some((v) => typeof v === "string" && credential(v)) ? "high" : "low";

const level = (content: string, tool = "Write") => ruleLevel(tool, content, classify);

describe("rule-risk: a wildcard inside a directory or file name (issue #435)", () => {
  test("a partial name that can be a control directory is refused for a write", () => {
    expect(level("/proj/.cl*/x")).toBe("any");
    expect(level("/proj/.git*/config")).toBe("any");
    expect(level("/proj/.gi?/hooks/pre-commit")).toBe("any");
    expect(level("/proj/.gith*/workflows/ci.yml")).toBe("any");
    expect(level("/proj/.hus*/pre-commit")).toBe("any");
    expect(level("/proj/.vsc*/tasks.json")).toBe("any");
  });

  test("a partial name that can be a control file is refused for a write", () => {
    expect(level("/proj/package.js*")).toBe("any");
    expect(level("/proj/.mcp.js?n")).toBe("any");
    expect(level("/proj/pack*.json")).toBe("any");
  });

  test("a partial name that can be a credential is refused for a read", () => {
    expect(level("/proj/.*/x", "Read")).toBe("any");
    expect(level("/proj/.s*h/x", "Read")).toBe("any");
    expect(level("/proj/.ss?/x", "Read")).toBe("any");
    expect(level("/proj/.a*s/credentials", "Read")).toBe("any");
    expect(level("/proj/.e*", "Read")).toBe("any");
    expect(level("/proj/id_r*", "Read")).toBe("any");
  });

  test("a sensitive path of several segments is matched across partial segments", () => {
    expect(level("/proj/.github/work*/x.yml")).toBe("any");
    expect(level("/proj/.github/w*/ci.yml")).toBe("any");
    expect(level("/proj/.gith*/work*/ci.yml")).toBe("any");
    expect(level("/proj/.vscode/tas*.json")).toBe("any");
    expect(level("/proj/.cl*/.cred*.json", "Read")).toBe("any");
    expect(level("/proj/.cl*/.credentials.j?on", "Read")).toBe("any");
    expect(level("/proj/.conf*/gh/hosts.yml", "Read")).toBe("any");
    expect(level("/proj/.config/g*/hosts.yml", "Read")).toBe("any");
    expect(level("/proj/.fl*/conf*.json", "Read")).toBe("any");
    expect(level("/proj/.flightdeck/c*.json", "Read")).toBe("any");
    expect(level("/proj/.flightdeck/conf*g.json", "Read")).toBe("any");
    expect(level("C:\\proj\\.cl*\\.cred*.json", "Read")).toBe("any");
  });

  test("the same on a drive path with backslashes", () => {
    expect(level("C:\\proj\\.cl*\\x")).toBe("any");
    expect(level("C:\\proj\\.s*h\\x", "Read")).toBe("any");
    expect(level("C:\\proj\\package.js*")).toBe("any");
  });

  test("a wildcard in an ordinary name stays narrow", () => {
    expect(level("/proj/src/app-*.ts")).toBe("low");
    expect(level("/proj/docs/page-?.md")).toBe("low");
    expect(level("/proj/src/app-*.ts", "Read")).toBe("low");
    expect(level("C:\\proj\\src\\app-*.ts")).toBe("low");
    expect(level("/proj/docs/conf*.md")).toBe("low");
    expect(level("/proj/src/work*/x.yml")).toBe("low");
    expect(level("/proj/.github-notes/page-*.md")).toBe("low");
  });
});
