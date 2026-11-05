import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

describe("css-utilities: the named styles of styles.css", () => {
  // Two `@utility` blocks with one name merge silently in Tailwind v4: the second one changes every
  // element that used the first (a field-row added for the card form undid the shared form rows).
  test("no named style is defined twice", () => {
    const names = [...css.matchAll(/^@utility ([\w-]+)/gm)].map((m) => m[1] as string);
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    expect(twice).toEqual([]);
  });
});
