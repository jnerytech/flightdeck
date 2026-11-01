import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { layoutViolations, styleViolations } from "../../../scripts/lib/style-lint.ts";

const DIR = resolve(import.meta.dir, "../src/components/clients");
const files = readdirSync(DIR).filter((name) => name.endsWith(".tsx"));

describe("clients-ui: the client components compose the layout primitives", () => {
  test("there are components to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s has no raw layout utility and no color outside the tokens", (name) => {
    const source = readFileSync(join(DIR, name), "utf8");
    expect(layoutViolations(source).map((v) => `${v.line}:${v.text}`)).toEqual([]);
    expect(styleViolations(source).map((v) => `${v.line}:${v.text}`)).toEqual([]);
  });
});
