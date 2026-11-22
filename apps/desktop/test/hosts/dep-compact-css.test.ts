import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../src/styles/hosts.css"), "utf8");
/** The body of the `dep-compact-found` rule of the stylesheet, or "". */
const found = /@utility dep-compact-found \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
/** The body of the `dep-compact` rule, or "". */
const row = /@utility dep-compact \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

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

  // A column the name and the word leave nearly empty at 390 px would break a path every few characters.
  test("takes its own line under the name in a narrow window, and the row aligns to its first line", () => {
    expect({
      ownLine: /@media \(max-width: 640px\) \{[^}]*grid-column:\s*2 \/ -1/.test(found),
      top: /align-items:\s*start/.test(row),
    }).toEqual({ ownLine: true, top: true });
  });

  // Chromium before 117 has no subgrid: its fixed columns were wider than a 390 px row, so the found column was 0 wide.
  test("the row without subgrid narrows to three columns in a narrow window", () => {
    expect(
      /@supports not[\s\S]*?@media \(max-width: 640px\) \{[^}]*grid-template-columns:\s*1rem minmax\(0, 1fr\) auto/.test(
        row,
      ),
    ).toBe(true);
  });
});
