import { describe, expect, test } from "bun:test";
import { posix, win32 } from "node:path";
import { displayPath } from "../src/memory/display-path.ts";

describe("memoria: caminho mostrado", () => {
  test("a Windows path comes out with / and keeps its drive", () => {
    const path = win32.join("C:\\Users\\dev\\repo", ".claude", "rules", "a", "b.md");
    expect(path).toBe("C:\\Users\\dev\\repo\\.claude\\rules\\a\\b.md");
    expect(displayPath(path, win32.sep)).toBe("C:/Users/dev/repo/.claude/rules/a/b.md");
  });

  test("a POSIX path stays as it is, even with a backslash in a name", () => {
    const path = posix.join("/home/dev/repo", ".claude", "rules", "a\\b.md");
    expect(displayPath(path, posix.sep)).toBe("/home/dev/repo/.claude/rules/a\\b.md");
  });

  test("with no separator given it uses the platform's", () => {
    expect(displayPath("/x/y.md")).toBe("/x/y.md");
  });
});
