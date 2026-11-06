import { describe, expect, test } from "bun:test";
import { credential } from "../src/permissions/risk.ts";
import { type ClassifyCall, type PathKind, ruleLevel } from "../src/permissions/rule-risk.ts";

// The classifier is the daemon's own on the path a call names; here, its credential rule alone.
const classify: ClassifyCall = (_tool, input) =>
  Object.values(input).some((v) => typeof v === "string" && credential(v)) ? "high" : "low";

// What is on disk does not matter here: each path is read as itself, never as a folder (#395).
const notThere: PathKind = () => "missing";
const level = (content: string, tool = "Write") => ruleLevel(tool, content, classify, notThere);

describe("rule-risk: a Windows path in a rule (issue #431)", () => {
  test("a wildcard inside a project on a drive, with backslashes, is as narrow as the same path with slashes", () => {
    expect(level("C:\\Users\\me\\proj\\app-*.txt")).toBe("low");
    expect(level("C:/Users/me/proj/app-*.txt")).toBe("low");
    expect(level("C:\\Users\\me\\proj\\src\\app-*.ts", "Edit")).toBe("low");
    expect(level("C:\\Users\\me\\proj\\log-?.txt", "Read")).toBe("low");
  });

  test("a wildcard that could stand for a credential is refused whichever slash it follows", () => {
    expect(level("C:\\Users\\me\\proj\\*")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\*.txt", "Read")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\src\\*\\a.ts", "Edit")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\*.pem", "Read")).toBe("any");
    expect(level("C:\\Users\\me\\.s*\\id_rsa", "Read")).toBe("any");
    expect(level("C:\\Users\\me\\.ssh\\*", "Read")).toBe("any");
  });

  test("a control file is refused for a write on a drive path, with or without a wildcard", () => {
    expect(level("C:\\Users\\me\\proj\\.claude\\settings.*")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\.git\\hooks\\*")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\.claude\\settings.json")).toBe("any");
    expect(level("C:\\Users\\me\\proj\\.github\\workflows\\*.yml")).toBe("any");
  });

  test("a backslash that escapes a wildcard is read both ways, and the broader one decides", () => {
    // `\*` is a literal star for the CLI, a separator and a wildcard for a Windows person.
    expect(level("C:\\Users\\me\\proj\\app-\\*.txt")).toBe("any");
    expect(level("C:\\Users\\me\\.ssh\\id\\*")).toBe("any");
  });

  test("a backslash that makes a parent step once it is removed is refused like the step itself", () => {
    expect(level("proj/.\\./app-*.txt", "Read")).toBe("any");
    expect(level("proj/.\\./app.txt", "Read")).toBe("any");
    expect(level("proj/../app-*.txt", "Read")).toBe("any");
  });

  test("a path with no wildcard and a credential name stays high on a drive", () => {
    expect(level("C:\\Users\\me\\.ssh\\id_rsa", "Read")).toBe("high");
    expect(level("C:\\Users\\me\\proj\\app.txt")).toBe("low");
  });
});
