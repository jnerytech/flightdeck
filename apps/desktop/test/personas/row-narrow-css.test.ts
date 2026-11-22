import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../src/styles/personas.css"), "utf8");
/** The body of the first narrow-window media block of the stylesheet, or "". */
const narrow = /@media \(max-width: 640px\) \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? "";

// #4215: at 390 px a row whose actions are Edit, Trust, Publish and Remove gave its auto column the width of all
// four buttons in a line, squeezed the name to nothing and made the page scroll sideways.
describe("a persona row in a narrow window", () => {
  test("puts its actions under the text, in the one column", () => {
    expect({
      oneColumn: /grid-template-columns:\s*minmax\(0, 1fr\);/.test(narrow),
      actionsBelow:
        /\[data-slot="persona-actions"\]\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*auto;/.test(
          narrow,
        ),
    }).toEqual({ oneColumn: true, actionsBelow: true });
  });
});
