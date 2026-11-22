import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../src/styles/hosts.css"), "utf8");
/** The body of the `dep-compact-found` rule of the stylesheet, or "". */
const found = /@utility dep-compact-found \{([^}]*)\}/.exec(css)?.[1] ?? "";

// #4322: a working dependency's path was cut to an ellipsis with the whole text only in a hover title, so a
// keyboard or touch user could not read it, and at 390 px the column was nearly empty.
describe("the found text of a dependency in the Working list", () => {
  test("wraps and breaks a long path instead of cutting it to an ellipsis", () => {
    expect({
      stays: found.length > 0,
      cut: /text-overflow:\s*ellipsis/.test(found) || /white-space:\s*nowrap/.test(found),
      breaks: /overflow-wrap:\s*anywhere/.test(found),
    }).toEqual({ stays: true, cut: false, breaks: true });
  });
});
