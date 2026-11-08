import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

/** The declarations of `selector` inside the stylesheet's `@media (width < 40rem)` block. */
function compactRule(selector: string): string {
  const start = css.indexOf("@media (width < 40rem) {");
  if (start < 0) return "";
  let depth = 0;
  let end = start;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    if (css[at] === "}" && --depth === 0) {
      end = at;
      break;
    }
  }
  const block = css.slice(start, end);
  const at = block.indexOf(`${selector} {`);
  return at < 0 ? "" : block.slice(at, block.indexOf("}", at));
}

// Issue #641, responsive spec "Dialogs": at 640 px and up a dialog stays centered; below it, it is
// a full-screen sheet whose body scrolls and whose footer stays at the bottom, the buttons stacked
// with the primary last. The vendored dialog keeps the CLI's classes and is placed by rules in the
// stylesheet, so the sheet is one of those rules. happy-dom does not evaluate media queries, so the
// rule's text is the proof; the prints check the screen.
describe("dialogo-compacto: below 640 px a dialog is a full-screen sheet", () => {
  test("the dialog's content fills the window, edge to edge, and scrolls", () => {
    const content = compactRule('[data-slot="dialog-content"]');
    for (const declaration of [
      "height: 100%",
      "max-height: none",
      "max-width: none",
      "margin: 0",
      "border-radius: 0",
      "flex-direction: column",
    ]) {
      expect(`${declaration}: ${content.includes(declaration)}`).toBe(`${declaration}: true`);
    }
  });

  test("a form in the dialog fills the sheet, so its footer can reach the bottom", () => {
    const form = compactRule('[data-slot="dialog-content"] > form');
    for (const declaration of ["flex: 1 0 auto", "flex-direction: column"]) {
      expect(`${declaration}: ${form.includes(declaration)}`).toBe(`${declaration}: true`);
    }
  });

  // #1249: the footer bleeds to the sheet's edges (margin: 0 -1.5rem). Inside a form, that bleed
  // must land on the form's own padding, or the footer sits 24 px past the form (narrow guard).
  test("a form in the sheet takes the sheet's padding as its own, so its footer stays inside it", () => {
    const form = compactRule('[data-slot="dialog-content"] > form');
    for (const declaration of ["margin: 0 -1.5rem -1.5rem", "padding: 0 1.5rem 1.5rem"]) {
      expect(`${declaration}: ${form.includes(declaration)}`).toBe(`${declaration}: true`);
    }
  });

  test("the footer stays at the bottom of the sheet, its buttons stacked with the primary last", () => {
    // A descendant, not a child: the New card dialog's footer is inside its form.
    const footer = compactRule('[data-slot="dialog-content"] [data-slot="dialog-footer"]');
    for (const declaration of ["position: sticky", "margin-top: auto", "flex-direction: column"]) {
      expect(`${declaration}: ${footer.includes(declaration)}`).toBe(`${declaration}: true`);
    }
  });

  test("a confirmation is not part of the sheet: a two-line question stays a centered box", () => {
    const start = css.indexOf("@media (width < 40rem) {");
    expect(start >= 0).toBe(true);
    expect(css.slice(start, css.indexOf("\n}\n", start)).includes("alert-dialog")).toBe(false);
  });
});
