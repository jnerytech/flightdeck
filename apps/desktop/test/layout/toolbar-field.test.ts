import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));
const hub = readFileSync(
  join(import.meta.dir, "../../src/features/sessions/sessions-hub.tsx"),
  "utf8",
);

/** The body of one `@utility` block. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
}

// Issue #2821: beside an open session the Sessions hub list is about 340 px wide. The filter field
// was `min-w-0 flex-1`, with a flex basis of 0, so it shrank to about 40 px and showed "Fil" while
// the toolbar never wrapped. A field in a toolbar keeps a usable width and wraps instead.
describe("toolbar-field: a filter field in a toolbar keeps a usable width", () => {
  test("it grows from a basis of 8rem and never shrinks below it", () => {
    const body = utility("toolbar-field");
    expect(/min-width:\s*8rem/.test(body)).toBe(true);
    expect(/flex:\s*1 1 8rem/.test(body)).toBe(true);
  });

  test("the Sessions hub filter field uses it instead of shrinking to nothing", () => {
    const field = hub.slice(hub.indexOf('aria-label={t("hub.filterLabel")}'));
    const className = /className="([^"]*)"/.exec(field)?.[1] ?? "";
    expect(className.split(" ").includes("toolbar-field")).toBe(true);
    expect(className.includes("flex-1")).toBe(false);
  });
});
