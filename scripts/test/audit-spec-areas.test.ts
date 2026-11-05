import { describe, expect, test } from "bun:test";
import { runAudit } from "../lib/tdd-audit.ts";

const git = (subjects: string[]) => (args: string[]) => {
  if (args[0] === "rev-parse") return "abc";
  if (args[0] === "log") return subjects.map((s, i) => `${i}\x1f${s}\x1f`).join("\n");
  return "";
};

describe("audit-spec-areas", () => {
  test("an area of the spec with no test commit in the range is a violation", () => {
    const result = runAudit({
      since: "v0.36.2",
      areas: ["board-map", "board-pull", "board-sync-ui"],
      git: git(["test(board-map): red", "feat(board-map): green", "test(board-sync-ui): red"]),
      readFile: () => "",
    });
    expect(result.code).toBe(1);
    expect(result.output.split("\n")).toEqual([
      "TDD AUDIT FAIL: 1 violação(ões)",
      "  -  board-pull  area of the spec with no test(board-pull) commit",
    ]);
  });

  test("every area tested passes, and without --spec nothing about areas is checked", () => {
    const log = git(["test(a): red", "test(b): red"]);
    expect(runAudit({ since: "v1", areas: ["a", "b"], git: log, readFile: () => "" }).code).toBe(0);
    expect(runAudit({ since: "v1", git: log, readFile: () => "" }).code).toBe(0);
  });
});
