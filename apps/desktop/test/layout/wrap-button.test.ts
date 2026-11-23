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

// Issue #4269: at 390 px a MCP row with a long server name pushed its Test button 165 px past the
// window. The vendored button is nowrap, fixed in height and does not shrink, so the style wraps the
// label and frees those. happy-dom has no layout: the narrow print agente-mcp-linha-longa measures it.
describe("wrap-button: a button labelled with a long name wraps it inside the window", () => {
  test("the label wraps, the height is released and the button may shrink", () => {
    const body = utility("wrap-button");
    expect({
      wraps: /white-space: normal/.test(body),
      freeHeight: /height: auto/.test(body),
      shrinks: /flex-shrink: 1/.test(body),
      breaksLongWords: /overflow-wrap: anywhere/.test(body),
    }).toEqual({ wraps: true, freeHeight: true, shrinks: true, breaksLongWords: true });
  });

  test("the rule outranks the vendored button's own classes through its attribute", () => {
    expect(utility("wrap-button")).toMatch(/&\[data-slot="button"\]/);
  });
});
