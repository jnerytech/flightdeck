import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

// Issue #641, narrow-window guard ("projeto-blocos" at 1024): a tile's pending request is a
// <fieldset>, and a fieldset will not shrink below its content (`min-inline-size: min-content`),
// so a request with a long line ran 51 px past its tile. It shrinks with the tile now, and its
// text breaks inside it.
describe("bloco-pedido: a tile's request stays inside its tile", () => {
  test("the request's fieldset can shrink below its content", () => {
    const at = css.indexOf("@utility session-tile-request {");
    const block = at < 0 ? "" : css.slice(at, css.indexOf("\n}", at));
    expect({
      shrinks: block.includes("min-inline-size: 0"),
      breaks: block.includes("overflow-wrap: anywhere"),
    }).toEqual({ shrinks: true, breaks: true });
  });
});
