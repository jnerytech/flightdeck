import { describe, expect, test } from "bun:test";
import { layoutViolations } from "../../../scripts/lib/style-lint.ts";

const found = (source: string) => layoutViolations(source).map((v) => v.text);

describe("layout-lint: raw layout utilities in a screen", () => {
  test("flags flex, grid, gaps, spacing and sizes, one hit per class, with its line", () => {
    const source = [
      '<div className="flex items-center gap-2 p-4">',
      '  <span className={cn("grid grid-cols-2 space-y-3", ok && "mx-2 w-40 h-8")} />',
      "</div>",
    ].join("\n");
    expect(layoutViolations(source)).toEqual([
      { line: 1, text: "flex", reason: "raw layout utility: compose a layout primitive" },
      { line: 1, text: "gap-2", reason: "raw layout utility: compose a layout primitive" },
      { line: 1, text: "p-4", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "grid", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "grid-cols-2", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "space-y-3", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "mx-2", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "w-40", reason: "raw layout utility: compose a layout primitive" },
      { line: 2, text: "h-8", reason: "raw layout utility: compose a layout primitive" },
    ]);
  });

  test("flags the directional and the limit forms, and variants keep their prefix", () => {
    expect(
      found(
        '<div className="px-3 pt-2 mt-4 gap-x-2 min-h-20 max-w-md inline-flex @2xl:grid hover:p-2 w-[240px]" />',
      ),
    ).toEqual([
      "px-3",
      "pt-2",
      "mt-4",
      "gap-x-2",
      "min-h-20",
      "max-w-md",
      "inline-flex",
      "@2xl:grid",
      "hover:p-2",
      "w-[240px]",
    ]);
  });

  test("lets the few that are not layout through: full size, the min 0, size, auto margins, child sizing", () => {
    expect(
      found(
        '<div className="w-full h-full min-w-0 min-h-0 size-4 mx-auto shrink-0 flex-1 flex-auto flex-col items-center text-sm" />',
      ),
    ).toEqual([]);
  });

  test("ignores comments and words that only look like classes", () => {
    const source = [
      "// a flex row with gap-2",
      "/** The grid of p-4 cards. */",
      " * a gap-2 here",
      'const label = "Group";',
      "const text = padding + margin;",
    ].join("\n");
    expect(found(source)).toEqual([]);
  });
});
