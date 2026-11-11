import { describe, expect, test } from "bun:test";
import { knipCounts } from "../../lib/knip-counts.ts";

const row = (file: string, over: Record<string, { name: string }[]> = {}) => ({
  file,
  files: [],
  exports: [],
  types: [],
  dependencies: [],
  devDependencies: [],
  unlisted: [],
  binaries: [],
  duplicates: [],
  unresolved: [],
  ...over,
});
const name = (n: string) => ({ name: n });

describe("knip-counts (#1606)", () => {
  test("findings are counted by kind across files, and kinds with none are left out", () => {
    const report = JSON.stringify({
      issues: [
        row("apps/daemon/src/a.ts", { exports: [name("one"), name("two")], types: [name("T")] }),
        row("apps/daemon/src/b.ts", { exports: [name("three")] }),
        row("apps/desktop/src/main.web.tsx", { files: [name("apps/desktop/src/main.web.tsx")] }),
        row("apps/desktop/package.json", { dependencies: [name("cmdk")] }),
      ],
    });
    expect(knipCounts(report)).toEqual({ exports: 3, types: 1, files: 1, dependencies: 1 });
  });

  test("an empty report has no findings", () => {
    expect(knipCounts(JSON.stringify({ issues: [] }))).toEqual({});
  });

  test("findings knip does not call dead code (duplicates, unresolved imports) are not counted", () => {
    const report = JSON.stringify({
      issues: [row("a.ts", { duplicates: [name("x")], unresolved: [name("./y")] })],
    });
    expect(knipCounts(report)).toEqual({});
  });

  test("text that is not a knip report fails with a message that says so", () => {
    expect(() => knipCounts("Error: cannot find config")).toThrow(/knip/);
    expect(() => knipCounts(JSON.stringify({ nope: 1 }))).toThrow(/knip/);
  });
});
