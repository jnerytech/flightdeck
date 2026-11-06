import { describe, expect, test } from "bun:test";
import { fastCoverageVerdict, fullyCovered } from "../lib/fast-coverage.ts";

const record = (path: string, fn: [number, number], ln: [number, number]) =>
  [
    `SF:${path}`,
    `FNF:${fn[1]}`,
    `FNH:${fn[0]}`,
    `LF:${ln[1]}`,
    `LH:${ln[0]}`,
    "end_of_record",
  ].join("\n");

describe("fast-coverage (#309)", () => {
  test("a file is fully covered at 100% lines and functions; only the listed sources count, sorted", () => {
    const lcov = [
      record("scripts/lib/b.ts", [2, 2], [10, 10]),
      record("scripts/lib/a.ts", [3, 3], [5, 5]),
      record("scripts/lib/half.ts", [1, 2], [5, 5]),
      record("scripts/lib/lines.ts", [1, 1], [4, 5]),
      record("apps/daemon/test/helper.ts", [1, 1], [1, 1]),
      record("scripts\\lib\\win.ts", [1, 1], [1, 1]),
    ].join("\n");
    const sources = [
      "scripts/lib/a.ts",
      "scripts/lib/b.ts",
      "scripts/lib/half.ts",
      "scripts/lib/lines.ts",
      "scripts/lib/win.ts",
    ];
    expect(fullyCovered(lcov, sources)).toEqual([
      "scripts/lib/a.ts",
      "scripts/lib/b.ts",
      "scripts/lib/win.ts",
    ]);
  });

  test("a listed file that dropped fails; a newly covered file is a gain, not a failure", () => {
    const sources = ["a.ts", "b.ts", "c.ts"];
    expect(fastCoverageVerdict(["a.ts", "c.ts"], ["a.ts", "b.ts"], sources)).toEqual({
      dropped: ["b.ts"],
      gained: ["c.ts"],
      gone: [],
    });
    expect(fastCoverageVerdict(["a.ts"], ["a.ts"], sources)).toEqual({
      dropped: [],
      gained: [],
      gone: [],
    });
  });

  test("a listed source that no longer exists (renamed or deleted) is gone, not dropped (#309)", () => {
    expect(fastCoverageVerdict(["a.ts"], ["a.ts", "old.ts"], ["a.ts"])).toEqual({
      dropped: [],
      gained: [],
      gone: ["old.ts"],
    });
  });
});
