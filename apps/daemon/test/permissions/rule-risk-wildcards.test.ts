import { describe, expect, test } from "bun:test";
import { credential } from "../../src/permissions/risk.ts";
import { type ClassifyCall, type PathKind, ruleLevel } from "../../src/permissions/rule-risk.ts";

// The classifier is the daemon's own on the path a call names; here, its credential rule alone.
const classify: ClassifyCall = (_tool, input) =>
  Object.values(input).some((v) => typeof v === "string" && credential(v)) ? "high" : "low";

// What is on disk does not matter here: each path is read as a file on disk (#395).
const notThere: PathKind = () => "file";
const level = (content: string, tool = "Read") => ruleLevel(tool, content, classify, notThere);

describe("rule-risk: what a wildcard in a path rule may stand for (#1607)", () => {
  test("a star that ends a name may stand for a credential extension, so the rule is refused", () => {
    expect(level("/proj/x*")).toBe("any");
    expect(level("/proj/gh*")).toBe("any");
    expect(level("/proj/src/a*")).toBe("any");
  });

  test("a star before a plain extension cannot reach a credential, so the rule stays narrow", () => {
    expect(level("/proj/src/a*.ts")).toBe("low");
  });

  test("a question mark may stand for the trailing dot that Windows drops, so a credential name with one is refused", () => {
    expect(level("/proj/.ssh?")).toBe("any");
    expect(level("/proj/x.pem?")).toBe("any");
    expect(level("/proj/x.key?")).toBe("any");
  });

  test("a question mark in a plain name cannot reach a credential, so the rule stays narrow", () => {
    expect(level("/proj/src/a?.ts")).toBe("low");
    expect(level("/proj/src/?/x.ts")).toBe("low");
  });
});
