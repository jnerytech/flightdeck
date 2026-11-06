import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");

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

// Issue #588 (spacing guard, projeto-blocos session-tile[5]): a tile's terminal tail wraps only at
// spaces and the tile hides what overflows, so a line with no spaces (a long path) was cut at the
// tile's edge, 1406 px of it out of sight. A line breaks anywhere instead, the way the
// Conversations rows do.
describe("linhas-bloco: a session tile's terminal line stays inside the tile", () => {
  test("a line with no spaces breaks at the tile's edge", () => {
    expect(utility("session-tile-lines")).toMatch(/& > span \{[^}]*overflow-wrap: anywhere/);
  });
});
