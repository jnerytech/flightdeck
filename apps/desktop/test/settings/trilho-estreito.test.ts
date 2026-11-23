import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));

/** The body of one `@utility` block, nested rules included. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    if (css[at] === "}" && --depth === 0) return css.slice(start, at + 1);
  }
  return "";
}

// Issue #4439: at 390 px the rail wrapped to four rows and, with the search, took 340 px of the 844 px
// window, so Appearance's first control sat below the fold. Narrow, the rail is one row that scrolls
// sideways; from 48 rem it is the column it always was. happy-dom has no layout: the narrow print of
// Settings is what measures the result.
describe("trilho-estreito: the settings rail takes one row in a narrow window (#4439)", () => {
  const body = utility("settings-rail");
  const at = body.indexOf("@container");
  const narrow = at < 0 ? body : body.slice(0, at);
  const wide = at < 0 ? "" : body.slice(at);

  test("narrow, the rail does not wrap and scrolls sideways, and its buttons keep their width", () => {
    expect({
      oneRow: /flex-wrap: nowrap/.test(narrow),
      scrolls: /overflow-x: auto/.test(narrow),
      buttonsKeepWidth: /flex-shrink: 0/.test(narrow),
    }).toEqual({ oneRow: true, scrolls: true, buttonsKeepWidth: true });
  });

  test("from 48 rem the rail is still a column that does not scroll", () => {
    expect({
      column: /flex-direction: column/.test(wide),
      noScroll: /overflow-x: visible/.test(wide),
    }).toEqual({ column: true, noScroll: true });
  });
});
