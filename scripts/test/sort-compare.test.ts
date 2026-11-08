import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exclusionsOf, isTestFile, matchesGlob, testInclusionsOf } from "../lib/sonar-project.ts";
import { bareSorts } from "../lib/sort-compare.ts";

// repo-wide (#1108): reads every tracked code file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../..");

describe("bareSorts", () => {
  test("finds a .sort() or .toSorted() with no compare function, by line", () => {
    const source = [
      "const a = names.sort();",
      "const b = names.sort(byCodeUnit);",
      "",
      "const c = list.toSorted( );",
    ].join("\n");
    expect(bareSorts(source)).toEqual([1, 4]);
  });

  test("finds a bare sort on its own line of a chain", () => {
    expect(bareSorts("readdirSync(dir)\n  .filter(Boolean)\n  .sort()\n  .map(String);")).toEqual([
      3,
    ]);
  });

  test("ignores a sort with a compare function or a sort named in a comment", () => {
    const source = [
      "// what a bare `.sort()` does",
      "/* a block that says .sort()",
      "   over two lines .toSorted() */",
      "names.sort((a, b) => a - b); // not .sort()",
      "names.toSorted(byCodeUnit);",
    ].join("\n");
    expect(bareSorts(source)).toEqual([]);
  });

  test("keeps the line numbers after a block comment", () => {
    expect(bareSorts("/*\n\n*/\nnames.sort();")).toEqual([4]);
  });
});

describe("the code has no bare sort (#322)", () => {
  test("every code file Sonar analyses as main code sorts with a compare function", () => {
    const properties = readFileSync(resolve(ROOT, "sonar-project.properties"), "utf8");
    const inclusions = testInclusionsOf(properties);
    const excluded = exclusionsOf(properties);
    const code = Bun.spawnSync(["git", "ls-files", "apps", "packages", "scripts"], {
      cwd: ROOT,
      stdout: "pipe",
    })
      .stdout.toString()
      .split("\n")
      .filter((path) => /\.(?:tsx?|[cm]?js)$/.test(path))
      .filter(
        (path) =>
          !isTestFile(path, inclusions) && !excluded.some((glob) => matchesGlob(glob, path)),
      );
    expect(code.length).toBeGreaterThan(300);
    const found = code.flatMap((path) =>
      bareSorts(readFileSync(resolve(ROOT, path), "utf8")).map((line) => `${path}:${line}`),
    );
    expect(found).toEqual([]);
  });
});
