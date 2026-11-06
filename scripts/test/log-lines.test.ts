import { describe, expect, test } from "bun:test";
import { logLines } from "./log-lines.ts";

describe("log-lines: what a stand-in program wrote, line by line", () => {
  test("a Windows .cmd's lines end in CRLF and carry the space before its redirection: both go", () => {
    expect(logLines("claude --version\r\naz --version \r\ngh --version \r\n")).toEqual([
      "claude --version",
      "az --version",
      "gh --version",
    ]);
  });

  test("a POSIX log reads the same, and an empty log has no lines", () => {
    expect(logLines("gh --version\naz --version\n")).toEqual(["gh --version", "az --version"]);
    expect(logLines("")).toEqual([]);
    expect(logLines("\n\n")).toEqual([]);
  });
});
