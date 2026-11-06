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

/** The declarations before the first nested rule: what applies at every width. */
const base = (block: string) => block.slice(block.indexOf("{") + 1, block.indexOf("@container"));
/** What applies inside the block's first container query. */
const wide = (block: string) => block.slice(block.indexOf("@container"));

// Issue #641, narrow-window guard: at 390 px the Settings page kept its section list beside the
// content, so the content was 130 px wide and every select, input and button ran past it (46
// findings). Narrow, the list goes above the content and each label above its control; the
// two-column layouts come back when their container has the room. happy-dom does not evaluate
// container queries, so the stylesheet's text is the proof; the narrow prints check the screen.
describe("ajustes-estreito: the Settings page fits a narrow window", () => {
  test("the section list sits above the content until the area is 48 rem wide", () => {
    const layout = utility("settings-layout");
    expect({
      base: base(layout).includes("grid-template-columns: minmax(0, 1fr)"),
      wide: /@container \(width >= 48rem\)[^}]*grid-template-columns: 13rem minmax\(0, 1fr\)/.test(
        wide(layout),
      ),
    }).toEqual({ base: true, wide: true });
  });

  test("narrow, the section links wrap in a row and the list does not stick", () => {
    const rail = utility("settings-rail");
    const side = utility("settings-side");
    expect({
      rail: base(rail).includes("flex-wrap: wrap") && base(rail).includes("flex-direction: row"),
      railWide: wide(rail).includes("flex-direction: column"),
      sideSticky: base(side).includes("position: sticky"),
      sideWide: wide(side).includes("position: sticky"),
    }).toEqual({ rail: true, railWide: true, sideSticky: false, sideWide: true });
  });

  test("the content is its own container, and a setting's label sits above its control until it is 30 rem wide", () => {
    const row = utility("setting-row");
    expect({
      container: utility("settings-sections").includes("container-type: inline-size"),
      base: base(row).includes("grid-template-columns: minmax(0, 1fr)"),
      wide: /@container \(width >= 30rem\)[^}]*grid-template-columns: 12rem minmax\(0, 1fr\)/.test(
        wide(row),
      ),
    }).toEqual({ container: true, base: true, wide: true });
  });
});
