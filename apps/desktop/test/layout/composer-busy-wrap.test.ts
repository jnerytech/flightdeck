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

// Issue #2727: at 720x480 the dock is about 332 px wide. While a turn runs the card holds three icon
// buttons, "Queue" and "Stop", so the message field kept about 15 px: it was not read or typed in.
describe("composer-busy-wrap: the message field keeps a line of its own while a turn runs", () => {
  test("a busy card gives the field its own line in a dock under 28 rem", () => {
    expect(utility("composer-card")).toMatch(
      /@container \(width < 28rem\) \{\s*&\[data-busy="true"\] \{[^}]*flex-wrap: wrap[^}]*& \.composer-box \{[^}]*order: -1[^}]*flex-basis: 100%/s,
    );
  });
});
