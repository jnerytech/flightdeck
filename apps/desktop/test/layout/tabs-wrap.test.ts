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

// Issue #4278: the Agent screen has six tabs, and in a 390 px window the strip ended 31 px past its
// container. The vendored list is a fixed-height inline flex row, so the style wraps it and frees the
// height. happy-dom has no layout: the narrow print of the Agent screen is what measures the result.
describe("tabs-wrap: a tab strip wider than its window wraps onto a second line", () => {
  test("the strip wraps and its fixed height is released", () => {
    const body = utility("tabs-wrap");
    expect({
      wraps: /flex-wrap: wrap/.test(body),
      freeHeight: /height: auto/.test(body),
    }).toEqual({ wraps: true, freeHeight: true });
  });

  test("the rule outranks the vendored list's own height, which is set through its group variant", () => {
    expect(utility("tabs-wrap")).toMatch(/&\[data-slot="tabs-list"\]\[data-variant\]/);
  });
});
