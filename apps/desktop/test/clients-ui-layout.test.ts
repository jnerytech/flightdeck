import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { layoutViolations, styleViolations } from "../../../scripts/lib/style-lint.ts";

/** The client components that compose the layout primitives; the screens beside them are not held to it. */
const files = ["assign-menu.tsx", "client-chip.tsx", "client-dot.tsx", "client-switcher.tsx"];
const DIR = resolve(import.meta.dir, "../src/features/clients");

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
