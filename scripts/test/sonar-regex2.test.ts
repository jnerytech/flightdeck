import { describe, expect, test } from "bun:test";
import { staticImports } from "../lib/bundle-reach.ts";
import { anchorsOf, githubSlug } from "../lib/md-links.ts";

const LIMIT_MS = 250;

/** How long a call takes, in milliseconds. */
function took(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("sonar-regex2: githubSlug unwraps links with the same result", () => {
  test("a link keeps its text, a malformed one is left as it is", () => {
    expect(githubSlug("See [the docs](docs/a.md) now")).toBe("see-the-docs-now");
    expect(githubSlug("[a](b) and [c](d)")).toBe("a-and-c");
    expect(githubSlug("[a](b)[c](d)")).toBe("ac");
    expect(githubSlug("x [a](b) [c](")).toBe("x-a-c");
    expect(githubSlug("[x]() y")).toBe("x-y");
    expect(githubSlug("[a [b](c)")).toBe("a-b");
    expect(githubSlug("[a]](b)")).toBe("ab");
    expect(githubSlug("[a](b(c)")).toBe("a");
    expect(githubSlug("[unclosed")).toBe("unclosed");
    expect(githubSlug("[a]b(c)")).toBe("abc");
    expect(githubSlug("[a](b")).toBe("ab");
  });

  test("a heading of 20k opening brackets is slugged in linear time", () => {
    expect(took(() => githubSlug("[".repeat(20_000)))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of unfinished links are slugged in linear time", () => {
    expect(took(() => githubSlug("[a](".repeat(5_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => githubSlug(`${"[a]".repeat(6_000)}(`))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex2: anchorsOf reads the heading text with the same result", () => {
  const anchors = (markdown: string) => [...anchorsOf(markdown)];

  test("the closing hashes and the spaces around the text are dropped", () => {
    expect(anchors("# Title")).toEqual(["title"]);
    expect(anchors("## Closing ##")).toEqual(["closing"]);
    expect(anchors("### Trailing   ")).toEqual(["trailing"]);
    expect(anchors("###### six")).toEqual(["six"]);
    expect(anchors("#### C#")).toEqual(["c"]);
    expect(anchors("# a # b #")).toEqual(["a--b"]);
    expect(anchors("# a#  # ")).toEqual(["a"]);
    expect(anchors("# [l](u) t")).toEqual(["l-t"]);
    expect(anchors("# foo\r")).toEqual(["foo"]);
  });

  test("an empty heading is an empty anchor, and a line that is not a heading adds none", () => {
    expect(anchors("# ")).toEqual([""]);
    expect(anchors("#\t")).toEqual([""]);
    expect(anchors("#   #")).toEqual([""]);
    expect(anchors("#nospace")).toEqual([]);
    expect(anchors("####### seven")).toEqual([]);
    expect(anchors("# foo\rbar")).toEqual([]);
  });

  test("a heading with a long run of spaces inside is read in linear time", () => {
    // The old pattern backtracked cubically here: 2000 spaces took seconds, 20k would take hours.
    expect(took(() => anchorsOf(`# a${" ".repeat(2_000)}x`))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of hashes in a heading are read in linear time", () => {
    expect(took(() => anchorsOf(`# a${"#".repeat(20_000)}x`))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of spaces and hashes that close a heading are read in linear time", () => {
    expect(took(() => anchorsOf(`# ${" ".repeat(20_000)}`))).toBeLessThan(LIMIT_MS);
    expect(took(() => anchorsOf(`# a${" #".repeat(10_000)}`))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex2: staticImports finds the same imports", () => {
  test("value imports and re-exports are listed, type-only ones are not", () => {
    expect(staticImports('import { type A, b } from "./m.ts"')).toEqual(["./m.ts"]);
    expect(staticImports('import type { A } from "./m.ts"')).toEqual([]);
    expect(staticImports('import a, { b } from "./m.ts"')).toEqual(["./m.ts"]);
    expect(staticImports('import a from "./m.ts"\nexport * from "./n.ts"')).toEqual([
      "./m.ts",
      "./n.ts",
    ]);
    expect(staticImports("  import   \"./side.ts\"\n\texport   { a }   from  './z.ts'")).toEqual([
      "./side.ts",
      "./z.ts",
    ]);
    expect(staticImports('import {} from "./k.ts"')).toEqual(["./k.ts"]);
    expect(staticImports('import { type } from "./k.ts"')).toEqual(["./k.ts"]);
    expect(staticImports('import { export as x } from "./x.ts"')).toEqual(["./x.ts"]);
    expect(staticImports('export type { A } from "./k.ts"\nexport type X = 1;')).toEqual([]);
    expect(staticImports('import * as ns from "react"; const x = "import a from b"')).toEqual([
      "react",
    ]);
  });

  test("an import of only types, on one line or several, with or without a comma, does not load", () => {
    expect(staticImports('import {\n type A,\n type B as C,\n} from "./t.ts";')).toEqual([]);
    expect(staticImports('import { type A  as B ,type C } from "./t.ts"')).toEqual([]);
    expect(staticImports('import { type A, } from "./k.ts"')).toEqual([]);
    expect(staticImports('import {type A} from "./k.ts"')).toEqual([]);
    expect(staticImports('import { type A type B } from "./k.ts"')).toEqual([]);
    expect(staticImports('import { type as } from "./k.ts"')).toEqual([]);
    expect(staticImports('import { type type } from "./k.ts"')).toEqual([]);
  });

  test("an import that mixes a value with types, or is not made of `type` entries, loads", () => {
    expect(staticImports('import { type A,, type B } from "./k.ts"')).toEqual(["./k.ts"]);
    expect(staticImports('import { type A as } from "./k.ts"')).toEqual(["./k.ts"]);
  });

  test("a statement that never finishes does not swallow the next import", () => {
    expect(staticImports('import a\nimport b from "./x.ts"')).toEqual(["./x.ts"]);
  });

  test("5000 import lines with no source are scanned in linear time", () => {
    expect(took(() => staticImports("import a\n".repeat(5_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => staticImports("export {\n".repeat(5_000)))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of type entries are checked in linear time", () => {
    const typed = `import { ${"type a ".repeat(3_000)}}  x from "y"`;
    expect(took(() => staticImports(typed))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of spaces after a type entry are checked in linear time", () => {
    const padded = `import { type a${" ".repeat(20_000)}x from "y"`;
    expect(took(() => staticImports(padded))).toBeLessThan(LIMIT_MS);
  });
});
