import { describe, expect, test } from "bun:test";
import {
  importsOf,
  newImports,
  resolveImport,
  selectRelated,
} from "../../lib/tests/test-related.ts";

const sources = (files: Record<string, string>) => new Map(Object.entries(files));

describe("importsOf", () => {
  test("reads static imports, re-exports, side-effect imports and import()", () => {
    const source = [
      `import a from "./a.ts";`,
      `import type { B } from "../b";`,
      `import "./side.ts";`,
      `import {`,
      `  c,`,
      `} from "@/lib/c";`,
      `export * from "./d.ts";`,
      `export { e } from "./e.ts";`,
      `const f = await import("./f.ts");`,
      `import g from "react";`,
    ].join("\n");
    expect(importsOf(source)).toEqual([
      "./a.ts",
      "../b",
      "./side.ts",
      "@/lib/c",
      "./d.ts",
      "./e.ts",
      "./f.ts",
      "react",
    ]);
  });

  test("a source without imports has none", () => {
    expect(importsOf("export const x = 1;")).toEqual([]);
  });

  test("a long run of spaces after the keyword is scanned in linear time (#363)", () => {
    const spaces = " ".repeat(20_000);
    const started = performance.now();
    const none = importsOf(`import${spaces}x`);
    const open = importsOf(`import(${spaces}"./a.ts")`);
    const plain = importsOf(`from${spaces}'./b.ts'`);
    const elapsed = performance.now() - started;
    expect(none).toEqual([]);
    expect(open).toEqual(["./a.ts"]);
    expect(plain).toEqual(["./b.ts"]);
    // The nested `\s*\(?\s*` of the old pattern took about 0.7 s here for the first call alone.
    expect(elapsed).toBeLessThan(250);
  });
});

describe("resolveImport", () => {
  const known = new Set([
    "apps/daemon/src/a.ts",
    "apps/daemon/src/dir/index.ts",
    "apps/desktop/src/lib/c.ts",
    "apps/desktop/src/ui/Card.tsx",
    "apps/desktop/test/helper.ts",
    "packages/protocol/src/index.ts",
  ]);

  test("relative specifiers, with and without extension or index", () => {
    expect(resolveImport("apps/daemon/test/x.test.ts", "../src/a.ts", known)).toBe(
      "apps/daemon/src/a.ts",
    );
    expect(resolveImport("apps/daemon/test/x.test.ts", "../src/a", known)).toBe(
      "apps/daemon/src/a.ts",
    );
    expect(resolveImport("apps/daemon/src/a.ts", "./dir", known)).toBe(
      "apps/daemon/src/dir/index.ts",
    );
    expect(resolveImport("apps/desktop/test/t.test.tsx", "../src/ui/Card", known)).toBe(
      "apps/desktop/src/ui/Card.tsx",
    );
  });

  test("a protocol subpath and any other workspace package resolve too, so no internal import falls out of the graph (#309)", () => {
    const more = new Set([...known, "packages/protocol/src/run.ts", "packages/other/src/index.ts"]);
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/protocol/run", more)).toBe(
      "packages/protocol/src/run.ts",
    );
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/other", more)).toBe(
      "packages/other/src/index.ts",
    );
  });

  test("the desktop alias and the protocol package", () => {
    expect(resolveImport("apps/desktop/src/x.ts", "@/lib/c", known)).toBe(
      "apps/desktop/src/lib/c.ts",
    );
    expect(resolveImport("apps/daemon/src/x.ts", "@flightdeck/protocol", known)).toBe(
      "packages/protocol/src/index.ts",
    );
  });

  test("packages, assets and missing files resolve to nothing", () => {
    expect(resolveImport("apps/daemon/src/x.ts", "react", known)).toBeNull();
    expect(resolveImport("apps/daemon/src/x.ts", "./missing", known)).toBeNull();
    expect(resolveImport("apps/desktop/src/x.ts", "./style.css", known)).toBeNull();
  });
});

describe("selectRelated", () => {
  const graph = sources({
    "apps/daemon/src/leaf.ts": "export const x = 1;",
    "apps/daemon/src/mid.ts": `import { x } from "./leaf.ts";`,
    "apps/daemon/src/other.ts": "export const y = 1;",
    "apps/daemon/test/helper.ts": `import { x } from "../src/mid.ts";`,
    "apps/daemon/test/direct.test.ts": `import { x } from "../src/leaf.ts";`,
    "apps/daemon/test/deep.test.ts": `import "./helper.ts";`,
    "apps/daemon/test/unrelated.test.ts": `import "../src/other.ts";`,
    "apps/daemon/test/cycle.test.ts": `import "../src/cycle-a.ts";`,
    "apps/daemon/src/cycle-a.ts": `import "./cycle-b.ts"; import "./leaf.ts";`,
    "apps/daemon/src/cycle-b.ts": `import "./cycle-a.ts";`,
  });

  test("a changed test file runs itself", () => {
    expect(selectRelated(["apps/daemon/test/unrelated.test.ts"], graph)).toEqual([
      { path: "apps/daemon/test/unrelated.test.ts", why: "changed" },
    ]);
  });

  test("tests that reach a changed source, directly or through helpers and cycles", () => {
    expect(selectRelated(["apps/daemon/src/leaf.ts"], graph)).toEqual([
      { path: "apps/daemon/test/cycle.test.ts", why: "imports apps/daemon/src/leaf.ts" },
      { path: "apps/daemon/test/deep.test.ts", why: "imports apps/daemon/src/leaf.ts" },
      { path: "apps/daemon/test/direct.test.ts", why: "imports apps/daemon/src/leaf.ts" },
    ]);
  });

  test("a test that is changed and also reached says changed", () => {
    expect(
      selectRelated(["apps/daemon/test/direct.test.ts", "apps/daemon/src/leaf.ts"], graph).find(
        (r) => r.path === "apps/daemon/test/direct.test.ts",
      ),
    ).toEqual({ path: "apps/daemon/test/direct.test.ts", why: "changed" });
  });

  test("files outside the graph select nothing", () => {
    expect(selectRelated(["docs/SPEC.md", "apps/daemon/src/gone.ts"], graph)).toEqual([]);
  });
});

describe("newImports (#762)", () => {
  const repo = sources({
    "scripts/lib/a.ts": "export const a = 1;",
    "scripts/lib/b.ts": "export const b = 1;",
    "scripts/lib/c.ts": "export const c = 1;",
    "scripts/test/a.test.ts": `import "../lib/a.ts";\nimport "../lib/b.ts";\nimport "bun:test";`,
    "scripts/test/new.test.ts": `import "../lib/c.ts";\nimport "@flightdeck/protocol";`,
    "packages/protocol/src/index.ts": "export const p = 1;",
  });
  const atBase: Record<string, string> = { "scripts/test/a.test.ts": `import "../lib/a.ts";` };
  const before = (path: string) => atBase[path] ?? null;

  test("names a file a changed test imports now and did not import at the base", () => {
    expect(newImports(["scripts/test/a.test.ts"], repo, before)).toEqual(["scripts/lib/b.ts"]);
  });

  test("a new test brings every file it imports, a workspace package's index too, and bun:test is left out", () => {
    expect(
      newImports(["scripts/test/a.test.ts", "scripts/test/new.test.ts"], repo, before),
    ).toEqual(["packages/protocol/src/index.ts", "scripts/lib/b.ts", "scripts/lib/c.ts"]);
  });

  test("a file the same change also edits is still named: #695 changed demo-shots.ts and its new importer at once", () => {
    expect(newImports(["scripts/test/a.test.ts", "scripts/lib/b.ts"], repo, before)).toEqual([
      "scripts/lib/b.ts",
    ]);
  });

  test("a changed source file or a removed test brings nothing", () => {
    expect(newImports(["scripts/lib/a.ts", "scripts/test/gone.test.ts"], repo, before)).toEqual([]);
  });
});
